"""ModuleIPC runner: speaks the NDJSON protocol on stdio.

Protocol (v1, matching packages/module-host/src/protocol.ts):
  host → module: {"v":1,"id","kind":"init"|"invoke"|"shutdown","payload":{...}}
  module → host: {"v":1,"id","kind":"ready"|"result"|"error"|"event"|"heartbeat","payload":{...}}

Run with ``python3 -m pinout_module <path-to-module.py>`` or via ``run_module``.
A background daemon thread sends heartbeats every second; the host treats a
silent worker as crashed.
"""

from __future__ import annotations

import json
import sys
import threading
from typing import Any, Callable

from .module import ModuleError, load_adapter_from_file, _ModuleAdapter

PROTOCOL_VERSION = 1


def _structured_error(error: Exception) -> dict:
    if isinstance(error, ModuleError):
        payload: dict[str, Any] = {
            "code": error.code,
            "category": error.category,
            "message": str(error),
            "retryable": error.retryable,
        }
        if error.details:
            payload["details"] = error.details
        return payload
    return {
        "code": "MODULE_INVOKE_FAILED",
        "category": "MODULE",
        "message": str(error),
        "retryable": False,
    }


class _Runner:
    def __init__(self, adapter: _ModuleAdapter, heartbeat_interval: float = 1.0) -> None:
        self.adapter = adapter
        self.heartbeat_interval = heartbeat_interval
        self._emit_lock = threading.Lock()
        adapter._transport_emit = self._emit_event

    def _emit_event(self, name: str, data: dict) -> None:
        with self._emit_lock:
            self._write({
                "v": PROTOCOL_VERSION,
                "kind": "event",
                "payload": {"event": name, "data": data},
            })

    @staticmethod
    def _write(message: dict) -> None:
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()

    def start_heartbeats(self) -> threading.Thread:
        def beat() -> None:
            import time

            while True:
                self._write({
                    "v": PROTOCOL_VERSION,
                    "kind": "heartbeat",
                    "payload": {"at": int(time.time() * 1000)},
                })
                time.sleep(self.heartbeat_interval)

        thread = threading.Thread(target=beat, daemon=True)
        thread.start()
        return thread

    def handle(self, request: dict) -> None:
        kind = request.get("kind")
        request_id = request.get("id")
        payload = request.get("payload") or {}

        if kind == "init":
            try:
                self.adapter.instance.on_init(payload.get("config") or {})
            except Exception as error:  # noqa: BLE001 — errors must cross IPC, never crash the loop
                self._write({
                    "v": PROTOCOL_VERSION,
                    "id": "init",
                    "kind": "error",
                    "payload": _structured_error(error),
                })
                return
            self._write({
                "v": PROTOCOL_VERSION,
                "id": "init",
                "kind": "ready",
                "payload": {
                    "capabilities": [
                        c.get("name")
                        for c in self.adapter.manifest.get("capabilities", [])
                        if isinstance(c, dict)
                    ]
                },
            })
            return

        if kind == "invoke":
            try:
                result = self.adapter.invoke(payload.get("capability", ""), payload.get("args") or {})
                self._write({"v": PROTOCOL_VERSION, "id": request_id, "kind": "result", "payload": {"result": result}})
            except Exception as error:  # noqa: BLE001 — errors must cross IPC, never crash the loop
                self._write({
                    "v": PROTOCOL_VERSION,
                    "id": request_id,
                    "kind": "error",
                    "payload": _structured_error(error),
                })
        elif kind == "shutdown":
            self.adapter.shutdown()
            sys.exit(0)

    def serve(self) -> None:
        """Read requests from stdin and dispatch them."""
        for line in sys.stdin:
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError:
                continue
            if request.get("v") != PROTOCOL_VERSION:
                continue
            self.handle(request)


def run_module(module_path: str) -> None:
    """CLI entry: host a module file over stdio ModuleIPC."""
    adapter = load_adapter_from_file(module_path, {})
    runner = _Runner(adapter)
    runner.start_heartbeats()
    runner.serve()


def run_module_stdio(module_cls: type) -> None:
    """Inline entry for modules that run themselves: run_module_stdio(MyDevice)."""
    adapter = _ModuleAdapter(module_cls, {})
    runner = _Runner(adapter)
    runner.start_heartbeats()
    runner.serve()


def main() -> None:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: python3 -m pinout_module <module-file.py>\n")
        sys.exit(2)
    run_module(sys.argv[1])


if __name__ == "__main__":
    main()
