import type {
  ControllerStatus,
  RosActionResult,
  RosCancelResponse,
  RosFeedback,
  RosGoalHandle,
} from './types.js';

export interface RosActionTransport<TGoal = unknown, TFeedback = unknown, TResult = unknown> {
  sendGoal(goal: TGoal, options?: { timeoutMs?: number }): Promise<RosGoalHandle<TGoal>>;
  onFeedback(
    handle: RosGoalHandle<TGoal>,
    callback: (feedback: RosFeedback<TFeedback>) => void,
  ): () => void;
  getResult(handle: RosGoalHandle<TGoal>): Promise<RosActionResult<TResult>>;
  cancelGoal(handle: RosGoalHandle<TGoal>): Promise<RosCancelResponse>;
  onControllerStatus(callback: (status: ControllerStatus) => void): () => void;
  close?(): Promise<void> | void;
}
