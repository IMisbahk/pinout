import {
  AbortedError,
  DeviceError,
  formatIsoTimestamp,
  getTimestampMs,
  PinoutStructuredError,
  recordAcknowledged,
  recordCommanded,
  recordObserved,
  StopUnconfirmedError,
  StreamBus,
  unknownEvidence,
  type DeviceBackend,
  type DeviceStateEvidence,
  type EvidenceState,
  type PinoutModuleDefinition,
} from '@pinout/core';
import {
  ros2ArmWorkspacePolicy,
  ros2SidecarCapabilities,
  ros2SidecarCapabilityNames,
} from './capabilities.js';
import { FakeRosActionServer } from './fakeRosActionServer.js';
import type { RosActionTransport } from './transport.js';
import type {
  ArmPoseFeedback,
  ArmPoseGoal,
  ArmPoseResult,
  CartesianPose,
  ControllerStatus,
  PoseTarget,
  Ros2SidecarConfig,
  RosGoalHandle,
} from './types.js';

export interface BackendInvocationContext {
  signal?: AbortSignal;
  reportProgress?: (fraction: number | null, message?: string) => void;
}

export const ros2SidecarModuleId = 'pinout/ros2-arm';

export const defaultAllowedFrames = [
  'base_link',
  'world',
  'tool0',
  'camera_optical_frame',
  'workspace',
] as const;

export class Ros2Sidecar implements DeviceBackend {
  readonly kind = 'simulated' as const;

  private readonly transport: RosActionTransport<ArmPoseGoal, ArmPoseFeedback, ArmPoseResult>;
  private readonly allowedFrames: Set<string>;
  private readonly maxTransformAgeMs: number;
  private readonly streamBus: StreamBus;
  private readonly deviceId: string;
  private readonly streamId: string;

  private controllerAlive = true;
  private lastControllerStatus: ControllerStatus = { alive: true, at: Date.now() };
  private activeGoal: RosGoalHandle<ArmPoseGoal> | undefined;
  private currentPosition: CartesianPose = { x: 0, y: 0, z: 0 };
  private currentFrame = 'base_link';
  private operationalStatus = 'ready';

  private positionEvidence: EvidenceState<CartesianPose> =
    unknownEvidence<CartesianPose>('simulated');
  private statusEvidence: EvidenceState<string> = unknownEvidence<string>('simulated');

  private readonly listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();
  private unsubscribeStatus: (() => void) | undefined;
  private closed = false;

  constructor(config: Ros2SidecarConfig = {}) {
    this.deviceId = config.deviceId ?? 'ros2-arm-01';
    this.streamId = `${this.deviceId}:feedback`;
    this.streamBus = config.streamBus ?? new StreamBus();
    this.allowedFrames = new Set(config.allowedFrames ?? defaultAllowedFrames);
    this.maxTransformAgeMs = config.maxTransformAgeMs ?? 5000;
    this.transport = config.transport ?? new FakeRosActionServer({ frame: 'base_link' });

    this.positionEvidence = recordObserved(
      this.positionEvidence,
      { ...this.currentPosition },
      'sensor',
      Date.now(),
      'simulated',
      this.maxTransformAgeMs,
    );
    this.statusEvidence = recordObserved(
      this.statusEvidence,
      'ready',
      'sensor',
      Date.now(),
      'simulated',
    );

    this.initializeStream();
    this.unsubscribeStatus = this.transport.onControllerStatus((status) => {
      this.controllerAlive = status.alive;
      this.lastControllerStatus = { ...status };
      if (!status.alive) {
        this.operationalStatus = 'faulted';
        this.statusEvidence = recordObserved(
          this.statusEvidence,
          'faulted',
          'sensor',
          status.at,
          'simulated',
        );
        this.emit('controller.lost', {
          reason: status.reason ?? 'ROS 2 controller communication lost.',
          at: status.at,
        });
      } else if (this.operationalStatus === 'faulted') {
        this.operationalStatus = 'ready';
        this.statusEvidence = recordObserved(
          this.statusEvidence,
          'ready',
          'sensor',
          status.at,
          'simulated',
        );
        this.emit('controller.recovered', { at: status.at });
      }
    });
  }

  get deviceIdentifier(): string {
    return this.deviceId;
  }

  get feedbackStreamId(): string {
    return this.streamId;
  }

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  getOperationalState(): Record<string, unknown> {
    return {
      status: this.operationalStatus,
      position: { ...this.currentPosition },
      frame: this.currentFrame,
      controllerAlive: this.controllerAlive,
      streamId: this.streamId,
    };
  }

  getOperationalStateEvidence(): DeviceStateEvidence {
    return {
      position: this.positionEvidence,
      status: this.statusEvidence,
    };
  }

  async safeState(): Promise<Record<string, unknown>> {
    return this.stopMotion();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeStatus?.();
    this.streamBus.closeStream(this.streamId);
    if (this.transport.close) {
      await this.transport.close();
    }
    this.listeners.clear();
  }

  async invoke(
    action: string,
    payload: Record<string, unknown>,
    context?: BackendInvocationContext,
  ): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'Ros2Sidecar backend is closed.');
    }

    switch (action) {
      case 'arm.move_to_pose':
        return this.moveToPose(payload, context);
      case 'arm.stop':
        return this.stopMotion();
      case 'arm.read_pose':
        return this.readPose();
      default:
        throw new PinoutStructuredError(
          'UNSUPPORTED_ACTION',
          'CAPABILITY',
          `Unknown action '${action}'.`,
          { details: { action } },
        );
    }
  }

  // --- Capability Implementations ---

  private async moveToPose(
    payload: Record<string, unknown>,
    context?: BackendInvocationContext,
  ): Promise<Record<string, unknown>> {
    const rawTarget = payload.target as PoseTarget | undefined;
    if (!rawTarget || !rawTarget.frame || !rawTarget.position) {
      throw new PinoutStructuredError(
        'INVALID_PAYLOAD',
        'VALIDATION',
        "Target with valid 'frame' and 'position' coordinates is required.",
      );
    }

    const { frame, position, orientation } = rawTarget;

    // 1. Frame check: Reject undeclared frames
    if (!this.allowedFrames.has(frame)) {
      throw new PinoutStructuredError(
        'FRAME_MISSING',
        'VALIDATION',
        `Coordinate frame '${frame}' is undeclared or missing in the robot frame tree.`,
        {
          details: {
            frame,
            allowedFrames: Array.from(this.allowedFrames),
          },
        },
      );
    }

    // 2. Staleness check: Reject expired perception/transform timestamps
    if (payload.transformAt !== undefined) {
      const transformMs = getTimestampMs(payload.transformAt as string | number);
      const now = Date.now();
      const ageMs = now - transformMs;
      const maxAge =
        typeof payload.maxTransformAgeMs === 'number'
          ? payload.maxTransformAgeMs
          : this.maxTransformAgeMs;

      if (Number.isNaN(transformMs) || ageMs > maxAge || ageMs < 0) {
        throw new PinoutStructuredError(
          'TRANSFORM_STALE',
          'SAFETY',
          `Perception transform for frame '${frame}' is stale (${ageMs}ms > maxAge ${maxAge}ms).`,
          {
            details: {
              frame,
              transformAt: payload.transformAt,
              ageMs,
              maxAgeMs: maxAge,
            },
          },
        );
      }
    }

    // 3. Workspace bounds validation
    if (
      position.x < -1.0 ||
      position.x > 1.0 ||
      position.y < -1.0 ||
      position.y > 1.0 ||
      position.z < 0.0 ||
      position.z > 1.5
    ) {
      throw new PinoutStructuredError(
        'OUT_OF_BOUNDS',
        'VALIDATION',
        `Target position (${position.x}, ${position.y}, ${position.z}) is outside robot workspace bounds.`,
        { details: { position } },
      );
    }

    // 4. Controller liveness check
    if (!this.controllerAlive) {
      throw new PinoutStructuredError(
        'CONTROLLER_UNAVAILABLE',
        'DEVICE',
        'ROS 2 action controller is unavailable or disconnected.',
        { details: { lastStatus: this.lastControllerStatus } },
      );
    }

    // Record commanded intent in state evidence
    const nowIso = formatIsoTimestamp();
    this.positionEvidence = recordCommanded(this.positionEvidence, { ...position }, nowIso);
    this.statusEvidence = recordCommanded(this.statusEvidence, 'busy', nowIso);
    this.operationalStatus = 'busy';

    const goal: ArmPoseGoal = {
      target: {
        frame,
        position: { ...position },
        ...(orientation ? { orientation: { ...orientation } } : {}),
      },
      ...(payload.transformAt !== undefined
        ? { transformAt: payload.transformAt as string | number }
        : {}),
      ...(payload.maxTransformAgeMs !== undefined
        ? { maxTransformAgeMs: payload.maxTransformAgeMs as number }
        : {}),
      ...(payload.velocityScaling !== undefined
        ? { velocityScaling: payload.velocityScaling as number }
        : {}),
    };

    const invokeStartTime = Date.now();
    let goalHandle: RosGoalHandle<ArmPoseGoal>;
    try {
      goalHandle = await this.transport.sendGoal(goal);
    } catch (error) {
      this.operationalStatus = 'faulted';
      throw new PinoutStructuredError(
        'CONTROLLER_COMMUNICATION_ERROR',
        'TRANSPORT',
        `Failed to send goal to ROS 2 action server: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    const commandOverheadMs = Math.max(0, Date.now() - invokeStartTime);

    if (!goalHandle.accepted) {
      this.operationalStatus = 'ready';
      throw new PinoutStructuredError(
        'GOAL_REJECTED',
        'DEVICE',
        'ROS 2 action controller rejected the requested goal.',
        { details: { goalId: goalHandle.goalId } },
      );
    }

    this.activeGoal = goalHandle;
    this.positionEvidence = recordAcknowledged(this.positionEvidence, { ...position }, Date.now());
    this.statusEvidence = recordAcknowledged(this.statusEvidence, 'busy', Date.now());

    let framesEmitted = 0;
    const unsubscribeFeedback = this.transport.onFeedback(goalHandle, (feedback) => {
      framesEmitted += 1;
      this.currentPosition = { ...feedback.feedback.currentPosition };
      this.currentFrame = feedback.feedback.frame;

      // Stream high-rate data to StreamBus ONLY — off MCP
      this.streamBus.publish(
        this.streamId,
        {
          currentPosition: feedback.feedback.currentPosition,
          jointPositions: feedback.feedback.jointPositions,
          jointVelocities: feedback.feedback.jointVelocities,
          fraction: feedback.feedback.fraction,
          frame: feedback.feedback.frame,
        },
        { sourceAt: feedback.feedback.controllerTimestamp },
      );

      context?.reportProgress?.(
        feedback.feedback.fraction,
        `Executing trajectory (fraction: ${(feedback.feedback.fraction * 100).toFixed(1)}%)`,
      );
    });

    // Handle cancellation signal if provided
    let abortListener: (() => void) | undefined;
    if (context?.signal) {
      abortListener = () => {
        void this.transport.cancelGoal(goalHandle).catch(() => undefined);
      };
      if (context.signal.aborted) {
        abortListener();
      } else {
        context.signal.addEventListener('abort', abortListener);
      }
    }

    try {
      const result = await this.transport.getResult(goalHandle);

      if (result.status === 'SUCCEEDED') {
        const reached = result.result?.reachedPosition ?? { ...position };
        this.currentPosition = { ...reached };
        this.currentFrame = result.result?.frame ?? frame;
        this.operationalStatus = 'ready';

        const completedAtIso = formatIsoTimestamp(result.at);
        this.positionEvidence = recordObserved(
          this.positionEvidence,
          { ...reached },
          'sensor',
          completedAtIso,
          'simulated',
          this.maxTransformAgeMs,
        );
        this.statusEvidence = recordObserved(
          this.statusEvidence,
          'ready',
          'sensor',
          completedAtIso,
          'simulated',
        );

        return {
          success: true,
          position: { ...reached },
          frame: this.currentFrame,
          durationMs: result.result?.durationMs ?? Date.now() - invokeStartTime,
          commandOverheadMs,
          evidence: {
            source: 'sensor',
            at: completedAtIso,
            provenance: 'simulated',
          },
          stream: {
            streamId: this.streamId,
            framesEmitted,
            sampleRateHz: 50,
          },
        };
      }

      if (result.status === 'CANCELED') {
        const reached = result.result?.reachedPosition ?? { ...this.currentPosition };
        this.currentPosition = { ...reached };
        this.operationalStatus = 'stopped';
        this.positionEvidence = recordObserved(
          this.positionEvidence,
          { ...reached },
          'sensor',
          Date.now(),
          'simulated',
        );
        this.statusEvidence = recordObserved(
          this.statusEvidence,
          'stopped',
          'sensor',
          Date.now(),
          'simulated',
        );

        throw new AbortedError('ROS 2 trajectory execution was cancelled and stop confirmed.');
      }

      // result.status === 'ABORTED'
      this.operationalStatus = 'faulted';
      this.statusEvidence = recordObserved(
        this.statusEvidence,
        'faulted',
        'sensor',
        Date.now(),
        'simulated',
      );
      throw new PinoutStructuredError(
        'CONTROLLER_ABORTED',
        'DEVICE',
        result.error ?? 'ROS 2 action was aborted by the controller.',
        { details: { goalId: goalHandle.goalId } },
      );
    } catch (error) {
      if (error instanceof DeviceError && error.code === 'DISCONNECTED') {
        this.operationalStatus = 'faulted';
        throw new PinoutStructuredError(
          'OPERATION_REQUIRES_RECONCILIATION',
          'OPERATION',
          'ROS 2 controller communication lost while trajectory in flight. Physical state is uncertain.',
          {
            details: {
              crashWindow: 'after_dispatch_before_ack',
              stopConfirmed: false,
              lastKnownPosition: this.currentPosition,
            },
          },
        );
      }
      throw error;
    } finally {
      unsubscribeFeedback();
      if (abortListener && context?.signal) {
        context.signal.removeEventListener('abort', abortListener);
      }
      if (this.activeGoal?.goalId === goalHandle.goalId) {
        this.activeGoal = undefined;
      }
    }
  }

  private async stopMotion(): Promise<Record<string, unknown>> {
    const active = this.activeGoal;
    let stopConfirmed = true;
    let activeGoalCancelled = false;

    if (active) {
      activeGoalCancelled = true;
      try {
        const cancelResponse = await this.transport.cancelGoal(active);
        stopConfirmed = cancelResponse.returnCode === 'ERROR_NONE';
      } catch {
        stopConfirmed = false;
      }
    }

    this.operationalStatus = 'stopped';
    const nowIso = formatIsoTimestamp();
    this.statusEvidence = recordObserved(
      this.statusEvidence,
      'stopped',
      'sensor',
      nowIso,
      'simulated',
    );

    if (!stopConfirmed) {
      throw new StopUnconfirmedError(
        'Stop requested but ROS 2 controller did not confirm physical halt.',
      );
    }

    return {
      status: 'stopped',
      stopConfirmed,
      at: nowIso,
      activeGoalCancelled,
    };
  }

  private readPose(): Record<string, unknown> {
    return {
      position: { ...this.currentPosition },
      frame: this.currentFrame,
      status: this.operationalStatus,
      evidence: {
        source: 'sensor',
        at: formatIsoTimestamp(this.positionEvidence.observed.at),
        provenance: 'simulated',
      },
    };
  }

  private initializeStream(): void {
    try {
      this.streamBus.register({
        id: this.streamId,
        deviceId: this.deviceId,
        name: 'ROS 2 Arm High-Rate Trajectory Feedback',
        nominalRateHz: 50,
        layout: 'ArmPoseFeedback',
        metadata: {
          units: { position: 'meters', velocity: 'rad/s' },
          dof: 6,
        },
      });
    } catch {
      // Already registered on this streamBus instance
    }
  }

  private emit(event: string, payload: Record<string, unknown>): void {
    for (const listener of this.listeners) {
      listener(event, payload);
    }
  }
}

export function createRos2SidecarBackend(config: Ros2SidecarConfig = {}): Ros2Sidecar {
  return new Ros2Sidecar(config);
}

export const ros2SidecarModule: PinoutModuleDefinition = {
  id: ros2SidecarModuleId,
  version: '0.1.0',
  deviceClass: 'robot.manipulator',
  vendor: 'Pinout ROS 2 Sidecar',
  model: 'Simulated 6-DOF Cartesian Arm Controller',
  capabilities: [...ros2SidecarCapabilities],
  capabilityNames: [...ros2SidecarCapabilityNames],
  policies: [ros2ArmWorkspacePolicy],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(options: Record<string, unknown> = {}): DeviceBackend {
    const motionDelayMs = typeof options.motionDelayMs === 'number' ? options.motionDelayMs : 20;
    const feedbackIntervalMs =
      typeof options.feedbackIntervalMs === 'number' ? options.feedbackIntervalMs : 5;
    const transport = new FakeRosActionServer({ motionDelayMs, feedbackIntervalMs });
    return createRos2SidecarBackend({
      transport,
      ...(typeof options.deviceId === 'string' ? { deviceId: options.deviceId } : {}),
    });
  },
};
