"""Pinout module-development SDK for Python.

Write a hardware module in Python against the vendor SDK you already have —
Pinout hosts it out-of-process and speaks ModuleIPC over stdio. From the
runtime's perspective a Python module registers exactly like a TypeScript one.

Minimal module::

    from pinout_module import PinoutModule, capability

    class MyDevice(PinoutModule):
        id = "vendor/mydevice"
        version = "0.1.0"
        device_class = "sensor.custom"
        capabilities = [
            capability("temperature.read", "Read the temperature", output={"value": "number"}),
            capability("heater.on", "Turn the heater on", physical_output=True),
        ]

        def invoke(self, name, args):
            if name == "heater.on":
                self.emit_event("heater.started", {})
                return {"on": True}
            if name == "temperature.read":
                return {"value": self.read_sensor()}
            raise ModuleError("UNSUPPORTED_CAPABILITY", f"no {name}")

    if __name__ == "__main__":
        run_module(MyDevice)

This SDK communicates over ModuleIPC. Process isolation means a crashed
module cannot crash the runtime — it is NOT a security sandbox.
"""

from .module import PinoutModule, DeviceBackend, ModuleError, capability
from .runner import run_module, run_module_stdio

__all__ = [
    "PinoutModule",
    "DeviceBackend",
    "ModuleError",
    "capability",
    "run_module",
    "run_module_stdio",
]
__version__ = "0.1.0"
