# ThermalBox TB-1 Operator Manual

Vendor: ThermalBox
Model: TB-1

## Temperature control

- The process temperature range is 20 C to 60 C.
- NOTE: the quickstart example in the SDK README shows set_temp(85). The
  manufacturer's documented safe maximum is 60 C. The example predates a
  hardware revision and is WRONG for current units.

## Cycle

- `start_cycle()` begins a thermal cycle. The door must be closed.
- Timing TBD by firmware version.
