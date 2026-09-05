# @pinout/ros2-sidecar

Narrow ROS 2 sidecar mapping robot actions to Pinout operations, feedback streams, and controller-confirmed evidence.

> **SIMULATOR ONLY**: Everything in this package is simulated in software. No physical hardware or robotics stack is actuated. Physical testing remains pending Phase 2–4 hardware gates.

## Overview

`@pinout/ros2-sidecar` maps bounded ROS 2 action executions (such as Cartesian arm positioning `arm.move_to_pose` and independent halt `arm.stop`) into Pinout's governed runtime:

- **Transport Abstraction**: `RosActionTransport` defines zero-dependency ROS 2 action semantics (`action_msgs`).
- **In-Process Simulator**: `FakeRosActionServer` models goal handles, progress feedback, controller loss, cancel acceptance, and abort injection.
- **Frame & Freshness Safety**: Strictly rejects missing coordinate frames (`FRAME_MISSING`) and stale perception transforms (`TRANSFORM_STALE`).
- **Stream Bus Integration**: High-rate trajectory feedback (50 Hz+) streams over `@pinout/core`'s `StreamBus`, keeping high-rate frames off the MCP/daemon control plane.
- **Physical Evidence**: Distinguishes commanded intent, acknowledgement, and controller-confirmed sensor evidence.
- **Uncertainty Preservation**: Controller loss mid-motion transitions to `requires_reconciliation`, preventing silent replays.

## Installation & Usage

```typescript
import { PinoutRuntime } from '@pinout/core';
import {
  createRos2SidecarBackend,
  FakeRosActionServer,
  ros2SidecarModule,
} from '@pinout/ros2-sidecar';

const transport = new FakeRosActionServer();
const backend = createRos2SidecarBackend({ transport });

const runtime = new PinoutRuntime();
runtime.registerModule(ros2SidecarModule);

const device = await runtime.registerDevice({
  id: 'arm-01',
  moduleId: ros2SidecarModule.id,
  backend,
});

const result = await device.invoke('arm.move_to_pose', {
  target: {
    frame: 'base_link',
    position: { x: 0.35, y: 0.15, z: 0.45 },
  },
  transformAt: Date.now(),
});
```
