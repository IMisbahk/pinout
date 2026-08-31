# Acme HeatBox 400 Manual

Vendor: Acme
Model: HeatBox 400

The HeatBox 400 is an environmental chamber for laboratory use.

## Communication

Connect via TCP port 9100.

## Temperature

Operating temperature: 10°C to 80°C.

Protocol commands:

```
SET TEMP <number>
GET TEMP
```

SDK functions:

```c
void set_temperature(float celsius);
float get_temperature();
```

## Door

```
OPEN DOOR
CLOSE DOOR
```

## Experiments

`experiment.start` requires the chamber door to be closed.

Timing semantics for experiment.start: TBD (unclear whether blocking).
