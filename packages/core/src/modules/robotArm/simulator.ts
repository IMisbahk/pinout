import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export interface ArmPose {
  x: number;
  y: number;
  z: number;
}

export type ArmOperationalStatus = 'ready' | 'busy' | 'faulted' | 'stopped';

export interface RobotArmState {
  status: ArmOperationalStatus;
  position: ArmPose;
  gripper: 'open' | 'closed';
  homed: boolean;
}

export interface SimulatedRobotArmOptions {
  motionDelayMs?: number;
}

export function createSimulatedRobotArmBackend(
  options: SimulatedRobotArmOptions = {},
): DeviceBackend {
  return new SimulatedRobotArmBackend(options.motionDelayMs ?? 5);
}

class SimulatedRobotArmBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private state: RobotArmState = {
    status: 'ready',
    position: { x: 0, y: 0, z: 0 },
    gripper: 'open',
    homed: true,
  };
  private motionTimer: ReturnType<typeof setTimeout> | undefined;
  private rejectMotion: ((reason: DeviceError) => void) | undefined;
  private listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();
  private closed = false;

  constructor(private readonly motionDelayMs: number) {}

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.motionTimer) {
      clearTimeout(this.motionTimer);
      this.motionTimer = undefined;
    }
    this.rejectMotion?.(new DeviceError('DISCONNECTED', 'Robot arm closed during motion.'));
    this.rejectMotion = undefined;
    this.listeners.clear();
  }

  getOperationalState(): Record<string, unknown> {
    return this.snapshotOperationalState();
  }

  async invoke(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'Simulated robot arm is closed.');
    }
    if (this.state.status === 'faulted') {
      throw new DeviceError('DEVICE_FAULT', 'Robot arm is faulted.');
    }

    switch (action) {
      case 'motion.home':
        return this.runMotion({ x: 0, y: 0, z: 0 }, () => {
          this.state.homed = true;
        });
      case 'motion.move_to':
        return this.runMotion(
          {
            x: requireNumber(payload.x, 'x'),
            y: requireNumber(payload.y, 'y'),
            z: requireNumber(payload.z, 'z'),
          },
          () => undefined,
        );
      case 'motion.stop':
        return this.stopMotion();
      case 'gripper.open':
        return this.setGripper('open');
      case 'gripper.close':
        return this.setGripper('closed');
      case 'pose.read':
        return {
          position: { ...this.state.position },
          gripper: this.state.gripper,
          homed: this.state.homed,
        };
      case 'status.read':
        return { ...this.snapshotOperationalState() };
      default:
        throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
    }
  }

  private snapshotOperationalState(): Record<string, unknown> {
    return {
      status: this.state.status,
      position: { ...this.state.position },
      gripper: this.state.gripper,
      homed: this.state.homed,
    };
  }

  private async runMotion(
    target: ArmPose,
    onComplete: () => void,
  ): Promise<Record<string, unknown>> {
    if (this.state.status === 'busy') {
      throw new DeviceError('DEVICE_BUSY', 'Robot arm is already moving.');
    }
    this.state.status = 'busy';
    this.emit('motion.started', { position: { ...this.state.position }, target });

    await new Promise<void>((resolve, reject) => {
      this.rejectMotion = reject;
      this.motionTimer = setTimeout(() => {
        this.motionTimer = undefined;
        this.rejectMotion = undefined;
        this.state.position = { ...target };
        this.state.status = 'ready';
        onComplete();
        this.emit('motion.completed', { position: { ...this.state.position } });
        resolve();
      }, this.motionDelayMs);
    });

    return { position: { ...this.state.position }, homed: this.state.homed };
  }

  private stopMotion(): Record<string, unknown> {
    const rejectMotion = this.rejectMotion;
    if (this.motionTimer) {
      clearTimeout(this.motionTimer);
      this.motionTimer = undefined;
    }
    this.rejectMotion = undefined;
    this.state.status = 'stopped';
    this.emit('motion.stopped', { position: { ...this.state.position } });
    this.state.status = 'ready';
    rejectMotion?.(new DeviceError('MOTION_STOPPED', 'Robot arm motion was stopped.'));
    return { status: 'stopped' };
  }

  private setGripper(gripper: 'open' | 'closed'): Record<string, unknown> {
    this.state.gripper = gripper;
    this.emit('gripper.changed', { gripper });
    return { gripper };
  }

  private emit(event: string, payload: Record<string, unknown>): void {
    for (const listener of this.listeners) {
      listener(event, payload);
    }
  }
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DeviceError('INVALID_PAYLOAD', `${field} must be a finite number.`);
  }
  return value;
}
