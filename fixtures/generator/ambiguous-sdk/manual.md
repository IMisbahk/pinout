# Terrible Sensor SDK (ambiguous)

Vendor: ChaosCorp
Model: MysterySensor 9000

## Temperature

Documentation v1 says operating range 10°C to 80°C.

Documentation v2 says maximum up to 120°C (inferred, not verified).

```javascript
function setTemp(value) {
  // unit unclear — might be Fahrenheit
}

function getTemp() {}
```

## Speed

Set motor speed — unit unknown.

## Deprecated

`legacy_read()` is deprecated. Do not use.
