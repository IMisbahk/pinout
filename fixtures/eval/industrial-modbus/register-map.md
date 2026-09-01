# ThermoPlant TP-9 Controller — Modbus Register Map

Vendor: ThermoPlant
Model: TP-9

Interface: Modbus TCP, port 502, unit id 2.

| Register | Area     | Name          | Access | Scale | Unit |
|----------|----------|---------------|--------|-------|------|
| 40001    | holding  | temperature   | read   | 0.1   | C    |
| 40002    | holding  | pressure      | read   | 0.01  | bar  |
| 40010    | holding  | setpoint      | write  | 0.1   | C    |
| 00004    | coil     | pump.run      | write  | 1     | bool |
| 30001    | input    | pump.hours    | read   | 1     | h    |

## Safety

- The pump.run coil must not be written while maintenance mode is active
  (holding register 40020 != 0).
- Setpoint range: 5.0 to 95.0 C.
