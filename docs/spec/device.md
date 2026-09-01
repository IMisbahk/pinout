# Devices

## Identity

A device has a stable identity (`DeviceIdentity`):

- `id` — unique within a runtime/daemon
- `moduleId` — the module that provides the backend
- `deviceClass` — namespaced category (`gpio`, `sensor.temperature`,
  `robot.manipulator`, `instrument.power-supply`, `industrial.plc`, …)
- optional `vendor`, `model`, `label`, `firmwareVersion`

## Health

Health is a small, honest enum — never a random string:
`CONNECTED | DEGRADED | FAULTED | DISCONNECTED | UNKNOWN`, alongside the
lifecycle (`connecting | ready | busy | faulted | stopped | disconnected`).
Faults are structured (`DeviceFault`) with `code`, `clearable`, and details.

## Descriptors

A `DeviceDescriptor` is the serialized summary of a device: identity,
capability ids, health, whether it is `simulated`, tags, transport
descriptor, and the honest `SupportStatus`
(`IMPLEMENTED | HARDWARE_VERIFIED | SIMULATED | COMPILE_TESTED | PLANNED | EXPERIMENTAL`).

Never blur support statuses: `SIMULATED` is not hardware-verified, and a
mocked test proves nothing about hardware.

## Composition — the DeviceGraph

Real systems contain components:

```
robot-cell-01
├── arm            (robot.manipulator)
│   └── force-sensor
├── gripper
└── wrist-camera
```

`DeviceGraph` (`packages/core/src/graph/deviceGraph.ts`) registers devices and
links parents to children. Applications address components with dotted paths:

```
robot-cell-01.arm.motion.move_to
robot-cell-01.gripper.gripper.close
robot-cell-01.arm.force-sensor.force.read
```

Resolution walks child-device segments first; the remaining dotted tail is the
capability id (capability ids may contain dots). Components may come from
different modules and vendors — composition is vendor-neutral. Cycles are
rejected at link time.

Queries: by `deviceClass`, `capability`, `moduleId`, `tag`, `parent`, and
`simulated`.
