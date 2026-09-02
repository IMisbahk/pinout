# @pinout/protocols-mqtt

Zero-dependency MQTT 3.1.1 client plus declarative topic↔capability mapping
for Pinout. Runs over any Pinout `Transport` (TCP today; loopback simulator
for tests).

## Status

`IMPLEMENTED` — wire-codec vectors and full client flows tested against an
in-process broker simulator (connect, subscribe, QoS-0/1 publish, PUBACK,
ping). Not verified against a production broker (Mosquitto/EMQX) yet.

## What's implemented

- CONNECT/CONNACK with clean session; username/password fields.
- SUBSCRIBE/SUBACK with `+` and `#` wildcard matching helpers.
- PUBLISH QoS 0 and QoS 1 (waits for PUBACK), incoming PUBLISH delivery.
- PINGREQ/PINGRESP keepalive, DISCONNECT.
- Declarative mapping: `topic → state field/event` ingestion with
  number/text/json codecs, and `capability → publish` rules where the payload
  template interpolates invoke arguments. Topics without a mapping never
  become capabilities; publishes require explicit rules.

## Not implemented

- QoS 2 (exactly-once), retained-message requests from the client, TLS
  (bring a TLS transport), MQTT 5 properties, last-will.
