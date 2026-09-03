"""HeatLamp — a real Python Pinout module example.

A simulated heat lamp with a thermal model: the lamp heats the target and it
cools naturally. Emits an over-temperature event; thresholds are configurable
via init config so integration tests can trigger deterministic events.
"""

import time

from pinout_module import PinoutModule, ModuleError, capability


class HeatLamp(PinoutModule):
    id = "examples/heatlamp"
    version = "0.1.0"
    device_class = "actuator.heat-lamp"

    capabilities = [
        capability("lamp.on", "Turn the lamp on", physical_output=True, reversible=True),
        capability("lamp.off", "Turn the lamp off"),
        capability("lamp.status", "Read lamp and thermal state", output={"on": "boolean", "temperature": "number"}),
        capability("lamp.force_overheat_event", "Test hook: push temperature past the limit for one tick"),
    ]

    def on_init(self, config: dict) -> None:
        self.on = False
        self.temperature = float((config or {}).get("initialTemperature", 20.0))
        self.max_temperature = float((config or {}).get("maxTemperature", 80.0))
        self.heat_per_tick = float((config or {}).get("heatPerTick", 0.5))
        self.cool_per_tick = float((config or {}).get("coolPerTick", 0.1))
        self.overheat_announced = False
        self._last_tick = time.monotonic()

    def invoke(self, name: str, args: dict) -> dict:
        self._tick()
        if name == "lamp.on":
            if self.on:
                return {"on": True, "already": True}
            self.on = True
            self.emit_event("lamp.turned_on", {"temperature": self.temperature})
            return {"on": True}
        if name == "lamp.off":
            self.on = False
            self.emit_event("lamp.turned_off", {"temperature": self.temperature})
            return {"on": False}
        if name == "lamp.status":
            return {"on": self.on, "temperature": round(self.temperature, 2)}
        if name == "lamp.force_overheat_event":
            # Test hook: jump past the limit so the event fires deterministically.
            self.temperature = self.max_temperature + 5
            self._check_overheat()
            return {"forced": True, "temperature": round(self.temperature, 2)}
        raise ModuleError("UNSUPPORTED_CAPABILITY", f"Capability '{name}' is not implemented.")

    def state(self) -> dict:
        self._tick()
        return {"on": self.on, "temperature": round(self.temperature, 2)}

    def _tick(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_tick
        self._last_tick = now
        if self.on:
            self.temperature += self.heat_per_tick * elapsed * 10
        else:
            self.temperature = max(20.0, self.temperature - self.cool_per_tick * elapsed * 10)
        self._check_overheat()

    def _check_overheat(self) -> None:
        if self.temperature >= self.max_temperature and not self.overheat_announced:
            self.overheat_announced = True
            self.emit_event("lamp.overtemperature", {
                "temperature": round(self.temperature, 2),
                "limit": self.max_temperature,
            })
        if self.temperature < self.max_temperature - 2:
            self.overheat_announced = False


MODULE_CLASS = HeatLamp
