"""Python-side tests for the pinout-module SDK (no Node required)."""

import json
import sys
from pathlib import Path

import pytest

SDK_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SDK_SRC))

from pinout_module import ModuleError, capability  # noqa: E402
from pinout_module.module import load_adapter_from_file  # noqa: E402
from pinout_module.runner import _Runner  # noqa: E402

HEATLAMP = Path(__file__).resolve().parents[1] / "examples" / "heatlamp" / "heatlamp.py"


class OutputSpy:
    def __init__(self):
        self.lines = []

    def write(self, message):
        # _write receives a dict (it normally json.dumps + flushes to stdout).
        self.lines.append(message if isinstance(message, dict) else json.loads(message))

    def find(self, kind, request_id=None):
        for line in self.lines:
            if line.get("kind") == kind and (request_id is None or line.get("id") == request_id):
                return line
        return None


@pytest.fixture()
def runner(monkeypatch):
    adapter = load_adapter_from_file(str(HEATLAMP), {"maxTemperature": 40.0, "initialTemperature": 20.0})
    spy = OutputSpy()
    runner = _Runner(adapter)
    runner._write = spy.write
    runner.adapter._transport_emit = runner._emit_event
    return runner, spy


def test_ready_capabilities(runner):
    r, spy = runner
    r.handle({"v": 1, "id": "init", "kind": "init", "payload": {"config": {"maxTemperature": 40.0}}})
    ready = spy.find("ready")
    assert ready is not None
    assert "lamp.on" in ready["payload"]["capabilities"]


def test_invoke_roundtrip(runner):
    r, spy = runner
    r.handle({"v": 1, "id": "1", "kind": "invoke", "payload": {"capability": "lamp.on", "args": {}}})
    result = spy.find("result", "1")
    assert result["payload"]["result"]["on"] is True
    event = spy.find("event")
    assert event["payload"]["event"] == "lamp.turned_on"


def test_unsupported_capability_is_structured_error(runner):
    r, spy = runner
    r.handle({"v": 1, "id": "2", "kind": "invoke", "payload": {"capability": "lamp.explode", "args": {}}})
    error = spy.find("error", "2")
    assert error["payload"]["code"] == "UNSUPPORTED_CAPABILITY"
    assert error["payload"]["category"] == "MODULE"


def test_overtemperature_event_is_deterministic(runner):
    r, spy = runner
    r.handle({"v": 1, "id": "3", "kind": "invoke", "payload": {"capability": "lamp.force_overheat_event", "args": {}}})
    event = spy.find("event")
    assert event["payload"]["event"] == "lamp.overtemperature"
    assert event["payload"]["data"]["limit"] == 40.0


def test_state_advances_after_heating(runner):
    r, _ = runner
    r.handle({"v": 1, "id": "4", "kind": "invoke", "payload": {"capability": "lamp.on", "args": {}}})
    import time

    time.sleep(0.35)
    status = r.adapter.invoke("lamp.status", {})
    assert status["temperature"] > 20.0
    assert status["on"] is True


def test_capability_helper_shapes_metadata():
    entry = capability("x.y", "does x", physical_output=True, arguments={"v": "number"})
    assert entry["safety"] == {"physicalOutput": True, "reversible": False}
    assert entry["inputSchema"]["properties"]["v"] == {"type": "number"}


def test_runner_protocol_framing_roundtrip():
    """Feed a full session through the runner: init → invoke → shutdown."""
    adapter = load_adapter_from_file(str(HEATLAMP), {})
    spy = OutputSpy()
    runner = _Runner(adapter)
    runner._write = spy.write

    session = [
        {"v": 1, "id": "init", "kind": "init", "payload": {"config": {}}},
        {"v": 1, "id": "a", "kind": "invoke", "payload": {"capability": "lamp.off", "args": {}}},
        {"v": 1, "id": "b", "kind": "invoke", "payload": {"capability": "lamp.status", "args": {}}},
    ]
    import threading

    serve_done = threading.Event()

    def serve_with_exit():
        try:
            runner.serve()
        except SystemExit:
            pass
        serve_done.set()

    import itertools

    counter = itertools.count()

    # Replace stdin with a feed.
    import io

    feed = io.StringIO("".join(json.dumps(request) + "\n" for request in session) + json.dumps({"v": 1, "id": "z", "kind": "shutdown", "payload": {}}) + "\n")
    real_stdin = sys.stdin
    sys.stdin = feed
    try:
        thread = threading.Thread(target=serve_with_exit, daemon=True)
        thread.start()
        import time

        deadline = time.monotonic() + 2
        while time.monotonic() < deadline and not serve_done.is_set():
            time.sleep(0.01)
    finally:
        sys.stdin = real_stdin

    kinds = [line.get("kind") for line in spy.lines]
    assert "ready" in kinds
    assert kinds.count("result") >= 2
    # Every line is valid protocol v1 NDJSON.
    for line in spy.lines:
        assert line.get("v") == 1
