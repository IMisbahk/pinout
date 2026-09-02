"""Core abstractions for Python Pinout modules."""

from __future__ import annotations

import json
from typing import Any, Callable


class ModuleError(Exception):
    """Structured error crossing ModuleIPC with a stable code.

    Applications (and the host) branch on ``code`` / ``category`` — never on
    prose.
    """

    def __init__(self, code: str, message: str, *, category: str = "MODULE",
                 retryable: bool = False, details: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.category = category
        self.retryable = retryable
        self.details = details or {}


class DeviceBackend:
    """Base class for a Python device backend.

    Subclass and override ``invoke``. Emit events and report state through the
    provided helpers; the runner forwards them to the host over ModuleIPC.
    """

    def __init__(self) -> None:
        self._emit: Callable[[str, dict], None] = lambda name, data: None
        self._set_state: Callable[[dict], None] = lambda state: None

    # -- lifecycle -----------------------------------------------------------

    def on_init(self, config: dict) -> None:
        """Called once with the init payload from the host."""

    def on_shutdown(self) -> None:
        """Called when the host requests a graceful shutdown."""

    # -- contract -------------------------------------------------------------

    def invoke(self, name: str, args: dict) -> dict:
        """Invoke a capability. Must return a JSON-serializable dict."""
        raise ModuleError("UNSUPPORTED_CAPABILITY", f"Capability '{name}' is not implemented.")

    def state(self) -> dict:
        """Current operational state snapshot."""
        return {}

    # -- host-facing helpers ----------------------------------------------------

    def emit_event(self, name: str, data: dict) -> None:
        """Emit an event to the host (forwarded to runtime subscribers)."""
        self._emit(name, data)

    def set_state(self, state: dict) -> None:
        """Replace the operational state snapshot."""
        self._set_state(state)


# Public alias: modules subclass PinoutModule; DeviceBackend is the same contract.
PinoutModule = DeviceBackend


def capability(
    name: str,
    description: str = "",
    *,
    physical_output: bool = False,
    reversible: bool = False,
    arguments: dict | None = None,
    output: dict | None = None,
    danger: str | None = None,
) -> dict:
    """Declare a capability with schema-lite metadata.

    ``arguments``/``output`` map field names to types ("number", "string",
    "boolean", "object") or to full JSON-schema dicts.
    """
    entry: dict[str, Any] = {
        "name": name,
        "description": description,
        "safety": {"physicalOutput": physical_output, "reversible": reversible},
    }
    if danger:
        entry["danger"] = danger
    if arguments:
        entry["inputSchema"] = {
            "type": "object",
            "properties": {k: (v if isinstance(v, dict) else {"type": v}) for k, v in arguments.items()},
        }
    if output:
        entry["outputSchema"] = {
            "type": "object",
            "properties": {k: (v if isinstance(v, dict) else {"type": v}) for k, v in output.items()},
        }
    return entry


class _ModuleAdapter:
    """Wraps a PinoutModule subclass instance into the runner contract."""

    def __init__(self, module_cls: type, config: dict) -> None:
        self.instance: PinoutModule = module_cls()
        self.manifest = {
            "id": getattr(module_cls, "id", "unknown/python-module"),
            "version": getattr(module_cls, "version", "0.0.0"),
            "deviceClass": getattr(module_cls, "device_class", "unknown"),
            "runtime": "python",
            "capabilities": getattr(module_cls, "capabilities", []),
        }
        self.instance._emit = self._forward_event
        self.instance._set_state = lambda state: setattr(self, "_state", state)
        self._state: dict = {}
        self.instance.on_init(config)

    def _forward_event(self, name: str, data: dict) -> None:
        # The runner injects a transport callback here.
        if self._transport_emit is not None:
            self._transport_emit(name, data)

    _transport_emit: Callable[[str, dict], None] | None = None

    def invoke(self, name: str, args: dict) -> dict:
        result = self.instance.invoke(name, args)
        return result if isinstance(result, dict) else {"value": result}

    def state_snapshot(self) -> dict:
        merged = dict(self.instance.state())
        merged.update(self._state)
        return merged

    def shutdown(self) -> None:
        self.instance.on_shutdown()


def load_adapter_from_file(path: str, config: dict) -> _ModuleAdapter:
    """Import a module file and wrap its PinoutModule subclass (or factory)."""
    import importlib.util
    import sys

    spec = importlib.util.spec_from_file_location("pinout_user_module", path)
    if spec is None or spec.loader is None:
        raise ModuleError("MODULE_LOAD_FAILED", f"Cannot load module file '{path}'.")
    module = importlib.util.module_from_spec(spec)
    sys.modules["pinout_user_module"] = module
    spec.loader.exec_module(module)

    candidate = None
    for name in dir(module):
        obj = getattr(module, name)
        if isinstance(obj, type) and issubclass(obj, PinoutModule) and obj is not PinoutModule:
            candidate = obj
            break
    if candidate is None and hasattr(module, "run_module"):
        candidate = getattr(module, "MODULE_CLASS", None)
    if candidate is None:
        raise ModuleError(
            "MODULE_LOAD_FAILED",
            f"Module file '{path}' defines no PinoutModule subclass.",
        )
    return _ModuleAdapter(candidate, config)


def dumps(obj: Any) -> str:
    return json.dumps(obj)
