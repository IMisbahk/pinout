import type { StreamBus } from '@pinout/core';
import type { RosActionTransport } from './transport.js';

export type RosGoalStatus =
  | 'STATUS_UNKNOWN'
  | 'STATUS_ACCEPTED'
  | 'STATUS_EXECUTING'
  | 'STATUS_CANCELING'
  | 'STATUS_SUCCEEDED'
  | 'STATUS_CANCELED'
  | 'STATUS_ABORTED';

export interface RosGoalHandle<TGoal = unknown> {
  readonly goalId: string;
  readonly accepted: boolean;
  readonly acceptedAt: number;
  readonly goal: TGoal;
  readonly status: RosGoalStatus;
}

export type RosCancelCode =
  'ERROR_NONE' | 'ERROR_REJECTED' | 'ERROR_UNKNOWN_GOAL_ID' | 'ERROR_GOAL_TERMINATED';

export interface RosCancelResponse {
  returnCode: RosCancelCode;
  goalsCanceling: string[];
  timestamp: number;
}

export interface RosFeedback<TFeedback = unknown> {
  goalId: string;
  sequence: number;
  at: number;
  feedback: TFeedback;
}

export interface RosActionResult<TResult = unknown> {
  goalId: string;
  status: 'SUCCEEDED' | 'CANCELED' | 'ABORTED';
  result?: TResult;
  error?: string;
  at: number;
}

export interface ControllerStatus {
  alive: boolean;
  at: number;
  reason?: string;
}

export interface CartesianPose {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionOrientation {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PoseTarget {
  frame: string;
  position: CartesianPose;
  orientation?: QuaternionOrientation;
}

export interface ArmPoseGoal {
  target: PoseTarget;
  transformAt?: number | string;
  maxTransformAgeMs?: number;
  velocityScaling?: number;
}

export interface ArmPoseFeedback {
  fraction: number;
  currentPosition: CartesianPose;
  jointPositions: number[];
  jointVelocities: number[];
  frame: string;
  controllerTimestamp: number;
}

export interface ArmPoseResult {
  reachedPosition: CartesianPose;
  jointPositions: number[];
  frame: string;
  durationMs: number;
  confirmedBy: 'encoder' | 'trajectory_controller';
  completedAt: number;
}

export interface Ros2SidecarConfig {
  transport?: RosActionTransport<ArmPoseGoal, ArmPoseFeedback, ArmPoseResult>;
  allowedFrames?: string[];
  maxTransformAgeMs?: number;
  streamBus?: StreamBus;
  deviceId?: string;
  defaultTimeoutMs?: number;
}
