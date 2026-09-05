# ADR 0008: ROS 2 Sidecar Boundary and Transport Abstraction

Status: Accepted

## Context

Robotic manipulators and mobile platforms often rely on ROS 2 (Robot Operating System 2) nodes and `ros2_control` stacks for real-time trajectory execution, joint kinematics, closed-loop motor commutation, and low-level protective reflexes. Meanwhile, Pinout provides the higher-level hardware abstraction layer, capability governance, lease arbitration, multi-agent coordination, operation journaling, state evidence tracking, and AI agent / MCP tool interfaces.

Bridging Pinout and ROS 2 requires an unambiguous architectural boundary. Without a clear division of responsibility:
1. Low-level high-frequency feedback loops could compete with high-level agent policies.
2. High-rate sensor data (joint streams, point clouds, camera frames) could flood the MCP stdio interface and daemon operation journals.
3. Open-ended "pass-through" ROS bindings could bypass Pinout's schema validation, frame safety checks, coordinate transformations, lease governance, and physical evidence contracts.
4. Native compilation dependencies (such as `rclnodejs` or ROS 2 C++ client libraries) would pollute the zero-dependency `@pinout/core` SDK and break lightweight CI pipelines.

## Decision

1. **Clear Division of Responsibility**:
   - **Pinout owns**: Discovery, permissions, lease arbitration, task admission, resource ownership, execution lifecycle (`queued`, `running`, `completed`, `cancelled`, `stop_unconfirmed`, `requires_reconciliation`), safety gating (`HaltCoordinator`, deadman timers, arming gates), frame validation and stale transform rejection, observation provenance, and high-rate stream references.
   - **ROS 2 Controller owns**: Real-time feedback loops (100 Hz–1 kHz), trajectory interpolation, inverse kinematics, motor torque limits, and immediate controller-level protective stops.

2. **Single Focused Action Mapping (No Generic Pass-Through)**:
   - The sidecar maps exactly **ONE** bounded robot action (`arm.move_to_pose`) matching Pinout's Cartesian robot arm capability conventions (`packages/core/src/modules/robotArm/capabilities.ts`) and frame specifications (`packages/core/src/frames/frames.ts`), plus an independent `arm.stop` capability.
   - Advertised capabilities are strictly scoped to the capabilities actually supported by the controller. Generic "raw topic publish" or unbounded "do anything" skills are forbidden.

3. **Separate Package Architecture (`@pinout/ros2-sidecar`)**:
   - The sidecar lives in `packages/ros2-sidecar` outside `@pinout/core`, honoring Pinout Rule 1 (keep `@pinout/core` free of product-specific robotics stacks) and Rule 5 (no speculative dependencies).
   - It integrates with Pinout via public `@pinout/core` APIs (`DeviceBackend`, `PinoutModuleDefinition`, `StreamBus`, `DeviceStateEvidence`).

4. **Zero-Dependency Transport Abstraction (`RosActionTransport`)**:
   - The sidecar defines a minimal `RosActionTransport` interface modeling standard ROS 2 action semantics (`action_msgs`):
     - `sendGoal(goal) -> RosGoalHandle`
     - `onFeedback(handle, callback)`
     - `getResult(handle) -> RosActionResult`
     - `cancelGoal(handle) -> RosCancelResponse`
     - `onControllerStatus(callback)` (alive/lost)
   - An in-process `FakeRosActionServer` implements this interface for testing, providing deterministic control over execution timing, feedback intervals, cancellation acceptance/rejection, abort injection, and controller disconnection.
   - Production deployments can implement `RosActionTransport` using `rclnodejs`, rosbridge WebSocket, or Zenoh/DDS without altering Pinout's core or sidecar logic.

5. **High-Rate Data Kept Off MCP**:
   - Intermediate joint telemetry and high-frequency Cartesian poses are routed to Pinout's `StreamBus` (`ros2-arm:feedback`), keeping them off the MCP stdio channel and daemon operation journal.
   - The capability invocation result returns only a timestamped summary, controller-verified evidence, and the stream reference ID.

6. **Rigorous Handling of Uncertainty & Stale State**:
   - **Missing Frame**: Target coordinates referencing undeclared or unknown coordinate frames are rejected immediately with `FRAME_MISSING`.
   - **Stale Transform**: Perception or pose targets older than `maxTransformAgeMs` are rejected immediately with `TRANSFORM_STALE`.
   - **Controller Loss Mid-Goal**: If the controller link drops while a trajectory is in flight, the operation transitions to `requires_reconciliation`, preserving the physical ambiguity and blocking silent retries.
   - **Cancellation & Unconfirmed Stop**: If cancellation is requested and the controller confirms the halt, the operation finishes as `cancelled` with `stopConfirmed: true`. If the controller rejects the cancel or drops off without confirmation, the outcome transitions to `stop_unconfirmed`.

7. **Simulator-Only Software Baseline**:
   - Everything in this package is **simulated only**.
   - Physical hardware execution remains strictly blocked until physical platform acceptance records and hardware gates (Phases 2–4) are completed.

## Consequences

- Pinout maintains its clean zero-dependency core and fast CI test matrix.
- Robotic arms controlled via ROS 2 actions can be governed through Pinout's standard leases, policies, and MCP tools with full safety guarantees.
- Ambiguous physical states (controller dropouts, unconfirmed stops) remain explicitly visible to human operators and autonomous agents.
- Real ROS 2 client implementations can be swapped in transparently via the transport abstraction.
