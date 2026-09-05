import { DeviceError } from '@pinout/core';
import type { RosActionTransport } from './transport.js';
import type {
  ArmPoseFeedback,
  ArmPoseGoal,
  ArmPoseResult,
  CartesianPose,
  ControllerStatus,
  RosActionResult,
  RosCancelResponse,
  RosFeedback,
  RosGoalHandle,
  RosGoalStatus,
} from './types.js';

export interface FakeRosActionServerOptions {
  motionDelayMs?: number;
  feedbackIntervalMs?: number;
  rejectGoals?: boolean;
  rejectCancel?: boolean;
  ignoreCancel?: boolean;
  abortMidMotion?: boolean;
  simulateControllerLossMs?: number;
  initialPosition?: CartesianPose;
  frame?: string;
}

interface ActiveGoal {
  handle: {
    goalId: string;
    accepted: boolean;
    acceptedAt: number;
    goal: ArmPoseGoal;
    status: RosGoalStatus;
  };
  startPosition: CartesianPose;
  currentPosition: CartesianPose;
  startTime: number;
  feedbackListeners: Set<(feedback: RosFeedback<ArmPoseFeedback>) => void>;
  resultPromise: Promise<RosActionResult<ArmPoseResult>>;
  resolveResult: (result: RosActionResult<ArmPoseResult>) => void;
  rejectResult: (reason: unknown) => void;
  timer?: ReturnType<typeof setInterval> | undefined;
  cancelRequested: boolean;
  stopConfirmed: boolean;
}

export class FakeRosActionServer implements RosActionTransport<
  ArmPoseGoal,
  ArmPoseFeedback,
  ArmPoseResult
> {
  private sequence = 0;
  private isAlive = true;
  private currentPosition: CartesianPose;
  private currentFrame: string;
  private readonly motionDelayMs: number;
  private readonly feedbackIntervalMs: number;
  private rejectGoals: boolean;
  private rejectCancel: boolean;
  private ignoreCancel: boolean;
  private abortMidMotion: boolean;
  private simulateControllerLossMs: number | undefined;

  private readonly activeGoals = new Map<string, ActiveGoal>();
  private readonly statusListeners = new Set<(status: ControllerStatus) => void>();
  private closed = false;

  constructor(options: FakeRosActionServerOptions = {}) {
    this.motionDelayMs = options.motionDelayMs ?? 20;
    this.feedbackIntervalMs = options.feedbackIntervalMs ?? 5;
    this.rejectGoals = options.rejectGoals ?? false;
    this.rejectCancel = options.rejectCancel ?? false;
    this.ignoreCancel = options.ignoreCancel ?? false;
    this.abortMidMotion = options.abortMidMotion ?? false;
    this.simulateControllerLossMs = options.simulateControllerLossMs;
    this.currentPosition = options.initialPosition
      ? { ...options.initialPosition }
      : { x: 0, y: 0, z: 0 };
    this.currentFrame = options.frame ?? 'base_link';
  }

  async sendGoal(goal: ArmPoseGoal): Promise<RosGoalHandle<ArmPoseGoal>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'FakeRosActionServer is closed.');
    }
    if (!this.isAlive) {
      throw new DeviceError('DISCONNECTED', 'ROS 2 controller is not alive.');
    }

    const goalId = `goal_${++this.sequence}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    let resolveResult!: (result: RosActionResult<ArmPoseResult>) => void;
    let rejectResult!: (reason: unknown) => void;
    const resultPromise = new Promise<RosActionResult<ArmPoseResult>>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    if (this.rejectGoals) {
      const handle: RosGoalHandle<ArmPoseGoal> = {
        goalId,
        accepted: false,
        acceptedAt: now,
        goal,
        status: 'STATUS_ABORTED',
      };
      const active: ActiveGoal = {
        handle: { ...handle },
        startPosition: { ...this.currentPosition },
        currentPosition: { ...this.currentPosition },
        startTime: now,
        feedbackListeners: new Set(),
        resultPromise,
        resolveResult,
        rejectResult,
        cancelRequested: false,
        stopConfirmed: false,
      };
      this.activeGoals.set(goalId, active);
      resolveResult({
        goalId,
        status: 'ABORTED',
        error: 'Goal was rejected by controller policy.',
        at: now,
      });
      return handle;
    }

    const handle: RosGoalHandle<ArmPoseGoal> = {
      goalId,
      accepted: true,
      acceptedAt: now,
      goal,
      status: 'STATUS_ACCEPTED',
    };

    const active: ActiveGoal = {
      handle: { ...handle, status: 'STATUS_EXECUTING' },
      startPosition: { ...this.currentPosition },
      currentPosition: { ...this.currentPosition },
      startTime: now,
      feedbackListeners: new Set(),
      resultPromise,
      resolveResult,
      rejectResult,
      cancelRequested: false,
      stopConfirmed: false,
    };

    this.activeGoals.set(goalId, active);
    this.startGoalExecution(active);

    return handle;
  }

  onFeedback(
    handle: RosGoalHandle<ArmPoseGoal>,
    callback: (feedback: RosFeedback<ArmPoseFeedback>) => void,
  ): () => void {
    const active = this.activeGoals.get(handle.goalId);
    if (!active) {
      return () => undefined;
    }
    active.feedbackListeners.add(callback);
    return () => active.feedbackListeners.delete(callback);
  }

  async getResult(handle: RosGoalHandle<ArmPoseGoal>): Promise<RosActionResult<ArmPoseResult>> {
    const active = this.activeGoals.get(handle.goalId);
    if (!active) {
      return {
        goalId: handle.goalId,
        status: 'ABORTED',
        error: `Unknown goal ID '${handle.goalId}'.`,
        at: Date.now(),
      };
    }
    return active.resultPromise;
  }

  async cancelGoal(handle: RosGoalHandle<ArmPoseGoal>): Promise<RosCancelResponse> {
    const active = this.activeGoals.get(handle.goalId);
    const now = Date.now();

    if (!active) {
      return {
        returnCode: 'ERROR_UNKNOWN_GOAL_ID',
        goalsCanceling: [],
        timestamp: now,
      };
    }

    if (
      active.handle.status === 'STATUS_SUCCEEDED' ||
      active.handle.status === 'STATUS_CANCELED' ||
      active.handle.status === 'STATUS_ABORTED'
    ) {
      return {
        returnCode: 'ERROR_GOAL_TERMINATED',
        goalsCanceling: [],
        timestamp: now,
      };
    }

    if (this.rejectCancel) {
      return {
        returnCode: 'ERROR_REJECTED',
        goalsCanceling: [],
        timestamp: now,
      };
    }

    if (this.ignoreCancel) {
      active.cancelRequested = true;
      active.stopConfirmed = false;
      return {
        returnCode: 'ERROR_REJECTED',
        goalsCanceling: [],
        timestamp: now,
      };
    }

    active.cancelRequested = true;
    active.stopConfirmed = true;
    active.handle.status = 'STATUS_CANCELING';

    if (active.timer) {
      clearInterval(active.timer);
      active.timer = undefined;
    }

    const currentPosition = { ...active.currentPosition };
    this.currentPosition = currentPosition;
    active.handle.status = 'STATUS_CANCELED';

    const resultPayload: ArmPoseResult = {
      reachedPosition: currentPosition,
      jointPositions: this.computeJointPositions(currentPosition),
      frame: active.handle.goal.target.frame || this.currentFrame,
      durationMs: Math.max(0, now - active.startTime),
      confirmedBy: 'encoder',
      completedAt: now,
    };

    active.resolveResult({
      goalId: active.handle.goalId,
      status: 'CANCELED',
      result: resultPayload,
      at: now,
    });

    return {
      returnCode: 'ERROR_NONE',
      goalsCanceling: [active.handle.goalId],
      timestamp: now,
    };
  }

  onControllerStatus(callback: (status: ControllerStatus) => void): () => void {
    this.statusListeners.add(callback);
    callback({ alive: this.isAlive, at: Date.now() });
    return () => this.statusListeners.delete(callback);
  }

  // --- Test Injection & Control Methods ---

  setControllerAlive(alive: boolean, reason?: string): void {
    this.isAlive = alive;
    const at = Date.now();
    const status: ControllerStatus = {
      alive,
      at,
      ...(reason !== undefined ? { reason } : {}),
    };
    for (const listener of this.statusListeners) {
      listener(status);
    }
    if (!alive) {
      for (const active of this.activeGoals.values()) {
        if (
          active.handle.status === 'STATUS_ACCEPTED' ||
          active.handle.status === 'STATUS_EXECUTING' ||
          active.handle.status === 'STATUS_CANCELING'
        ) {
          if (active.timer) {
            clearInterval(active.timer);
            active.timer = undefined;
          }
          active.handle.status = 'STATUS_ABORTED';
          active.rejectResult(
            new DeviceError('DISCONNECTED', reason ?? 'Controller disconnected mid-trajectory.'),
          );
        }
      }
    }
  }

  triggerAbort(reason = 'Controller internal emergency abort'): void {
    for (const active of this.activeGoals.values()) {
      if (
        active.handle.status === 'STATUS_ACCEPTED' ||
        active.handle.status === 'STATUS_EXECUTING' ||
        active.handle.status === 'STATUS_CANCELING'
      ) {
        if (active.timer) {
          clearInterval(active.timer);
          active.timer = undefined;
        }
        active.handle.status = 'STATUS_ABORTED';
        active.resolveResult({
          goalId: active.handle.goalId,
          status: 'ABORTED',
          error: reason,
          at: Date.now(),
        });
      }
    }
  }

  triggerControllerLoss(reason = 'Physical link dropped'): void {
    this.setControllerAlive(false, reason);
  }

  setRejectCancel(reject: boolean): void {
    this.rejectCancel = reject;
  }

  setIgnoreCancel(ignore: boolean): void {
    this.ignoreCancel = ignore;
  }

  setRejectGoals(reject: boolean): void {
    this.rejectGoals = reject;
  }

  getCurrentPosition(): CartesianPose {
    return { ...this.currentPosition };
  }

  getControllerStatus(): ControllerStatus {
    return { alive: this.isAlive, at: Date.now() };
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const active of this.activeGoals.values()) {
      if (active.timer) {
        clearInterval(active.timer);
        active.timer = undefined;
      }
      if (
        active.handle.status === 'STATUS_ACCEPTED' ||
        active.handle.status === 'STATUS_EXECUTING'
      ) {
        active.rejectResult(new DeviceError('DISCONNECTED', 'Action server closed.'));
      }
    }
    this.activeGoals.clear();
    this.statusListeners.clear();
  }

  // --- Private Execution Logic ---

  private startGoalExecution(active: ActiveGoal): void {
    const target = active.handle.goal.target.position;
    const start = active.startPosition;
    const targetFrame = active.handle.goal.target.frame || this.currentFrame;
    let sequence = 0;

    active.timer = setInterval(() => {
      if (!this.isAlive || this.closed) {
        if (active.timer) {
          clearInterval(active.timer);
          active.timer = undefined;
        }
        return;
      }

      const elapsed = Date.now() - active.startTime;

      if (this.simulateControllerLossMs !== undefined && elapsed >= this.simulateControllerLossMs) {
        if (active.timer) {
          clearInterval(active.timer);
          active.timer = undefined;
        }
        this.triggerControllerLoss('Simulated controller loss deadline reached.');
        return;
      }

      const fraction = Math.min(1, Math.max(0, elapsed / this.motionDelayMs));

      if (this.abortMidMotion && fraction >= 0.4) {
        if (active.timer) {
          clearInterval(active.timer);
          active.timer = undefined;
        }
        active.handle.status = 'STATUS_ABORTED';
        active.resolveResult({
          goalId: active.handle.goalId,
          status: 'ABORTED',
          error: 'Simulated mid-motion abort triggered.',
          at: Date.now(),
        });
        return;
      }

      active.currentPosition = {
        x: start.x + (target.x - start.x) * fraction,
        y: start.y + (target.y - start.y) * fraction,
        z: start.z + (target.z - start.z) * fraction,
      };
      this.currentPosition = { ...active.currentPosition };

      const feedbackPayload: ArmPoseFeedback = {
        fraction,
        currentPosition: { ...active.currentPosition },
        jointPositions: this.computeJointPositions(active.currentPosition),
        jointVelocities: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
        frame: targetFrame,
        controllerTimestamp: Date.now(),
      };

      const feedbackEvent: RosFeedback<ArmPoseFeedback> = {
        goalId: active.handle.goalId,
        sequence: ++sequence,
        at: Date.now(),
        feedback: feedbackPayload,
      };

      for (const listener of active.feedbackListeners) {
        listener(feedbackEvent);
      }

      if (fraction >= 1) {
        if (active.timer) {
          clearInterval(active.timer);
          active.timer = undefined;
        }
        active.handle.status = 'STATUS_SUCCEEDED';
        this.currentPosition = { ...target };

        const resultPayload: ArmPoseResult = {
          reachedPosition: { ...target },
          jointPositions: this.computeJointPositions(target),
          frame: targetFrame,
          durationMs: Date.now() - active.startTime,
          confirmedBy: 'encoder',
          completedAt: Date.now(),
        };

        active.resolveResult({
          goalId: active.handle.goalId,
          status: 'SUCCEEDED',
          result: resultPayload,
          at: Date.now(),
        });
      }
    }, this.feedbackIntervalMs);
  }

  private computeJointPositions(pos: CartesianPose): number[] {
    const theta1 = Math.atan2(pos.y, pos.x || 0.0001);
    const r = Math.hypot(pos.x, pos.y);
    const theta2 = Math.atan2(pos.z, r || 0.0001);
    const theta3 = Math.sin(pos.x + pos.y);
    const theta4 = Math.cos(pos.z);
    const theta5 = Math.sin(pos.y);
    const theta6 = 0.0;
    return [theta1, theta2, theta3, theta4, theta5, theta6];
  }
}
