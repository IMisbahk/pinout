/**
 * Global safety halt coordinator (spec v1).
 *
 * IMPORTANT — NOT A CERTIFIED EMERGENCY-STOP SYSTEM.
 *
 * This coordinates *software-side* response to halt requests: rejecting new
 * physical side-effect invocations, tracking which devices require attention,
 * and emitting audit events. It does NOT and CANNOT replace hardware e-stop
 * circuits, safety relays, or certified emergency stop systems. Any deployment
 * that moves machinery must have independent hardware safeguards; a software
 * API can complement them but never substitute for them.
 *
 * States:
 *   NORMAL          — regular operation.
 *   RESTRICTED      — a deployment-defined reduced-permission mode.
 *   HALTED          — new physical actions rejected; cancellable ops should be
 *                     cancelled by the caller using this coordinator's verdict.
 *   ESTOP_REQUESTED — an emergency stop was requested. Sticky: requires an
 *                     explicit clear (clearEstop) before resume() is accepted.
 *   FAULTED         — a runtime fault requires attention; resume allowed only
 *                     after clearFault.
 */
import { PinoutStructuredError } from '../errors.js';

export type SafetyStateName = 'NORMAL' | 'RESTRICTED' | 'HALTED' | 'ESTOP_REQUESTED' | 'FAULTED';

export interface SafetyStateChange {
  from: SafetyStateName;
  to: SafetyStateName;
  reason: string;
  actor?: string;
  at: number;
}

export interface HaltVerdict {
  allowed: boolean;
  code?: string;
  message?: string;
}

export interface HaltCoordinatorOptions {
  now?: () => number;
  onStateChange?: (change: SafetyStateChange) => void;
}

export class HaltCoordinator {
  private currentState: SafetyStateName = 'NORMAL';
  private currentReason = '';
  private estopRequested = false;
  private faulted = false;
  private readonly listeners = new Set<(change: SafetyStateChange) => void>();
  private readonly nowFn: () => number;
  private readonly externalOnStateChange: ((change: SafetyStateChange) => void) | undefined;

  constructor(options: HaltCoordinatorOptions = {}) {
    this.nowFn = options.now ?? Date.now;
    this.externalOnStateChange = options.onStateChange;
  }

  get state(): SafetyStateName {
    return this.currentState;
  }

  get reason(): string {
    return this.currentReason;
  }

  get isEstopRequested(): boolean {
    return this.estopRequested;
  }

  /** Whether an invocation with physical side effects may proceed right now. */
  gate(): HaltVerdict {
    switch (this.currentState) {
      case 'NORMAL':
      case 'RESTRICTED':
        return { allowed: true };
      case 'HALTED':
        return {
          allowed: false,
          code: 'SAFETY_HALTED',
          message: this.currentReason || 'Runtime is halted.',
        };
      case 'ESTOP_REQUESTED':
        return {
          allowed: false,
          code: 'SAFETY_ESTOP_REQUESTED',
          message: this.currentReason || 'Emergency stop requested.',
        };
      case 'FAULTED':
        return {
          allowed: false,
          code: 'SAFETY_FAULTED',
          message: this.currentReason || 'Runtime is faulted.',
        };
    }
  }

  /** Throw a structured SAFETY error when gated. */
  enforceGate(): void {
    const verdict = this.gate();
    if (!verdict.allowed) {
      throw new PinoutStructuredError(
        verdict.code ?? 'SAFETY_HALTED',
        'SAFETY',
        verdict.message ?? 'Physical action rejected by safety state.',
        {
          details: { state: this.currentState },
        },
      );
    }
  }

  halt(reason: string, actor?: string): void {
    this.transition('HALTED', reason, actor);
  }

  requestEstop(reason: string, actor?: string): void {
    this.estopRequested = true;
    this.transition('ESTOP_REQUESTED', reason, actor);
  }

  /**
   * Clear the estop flag. The runtime stays HALTED; an explicit resume() is
   * still required to return to NORMAL. This two-step flow prevents an
   * emergency stop from being undone by accident.
   */
  clearEstop(actor?: string): void {
    if (!this.estopRequested) return;
    this.estopRequested = false;
    if (this.currentState === 'ESTOP_REQUESTED') {
      this.transition('HALTED', 'Estop cleared; awaiting explicit resume.', actor);
    }
  }

  fault(reason: string, actor?: string): void {
    this.faulted = true;
    this.transition('FAULTED', reason, actor);
  }

  clearFault(actor?: string): void {
    if (!this.faulted) return;
    this.faulted = false;
    if (this.currentState === 'FAULTED') {
      this.transition('NORMAL', 'Fault cleared.', actor);
    }
  }

  resume(reason = 'Resume requested', actor?: string): void {
    if (this.estopRequested) {
      throw new PinoutStructuredError(
        'SAFETY_ESTOP_STILL_ACTIVE',
        'SAFETY',
        'Emergency stop has not been cleared; call clearEstop() first.',
      );
    }
    if (this.faulted) {
      throw new PinoutStructuredError(
        'SAFETY_FAULT_STILL_ACTIVE',
        'SAFETY',
        'Fault has not been cleared; call clearFault() first.',
      );
    }
    if (this.currentState === 'HALTED' || this.currentState === 'RESTRICTED') {
      this.transition('NORMAL', reason, actor);
    }
  }

  restrict(reason: string, actor?: string): void {
    if (this.currentState === 'NORMAL') {
      this.transition('RESTRICTED', reason, actor);
    }
  }

  subscribe(listener: (change: SafetyStateChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private transition(to: SafetyStateName, reason: string, actor?: string): void {
    if (this.currentState === to && this.currentReason === reason) return;
    const change: SafetyStateChange = {
      from: this.currentState,
      to,
      reason,
      ...(actor !== undefined ? { actor } : {}),
      at: this.nowFn(),
    };
    this.currentState = to;
    this.currentReason = reason;
    for (const listener of this.listeners) {
      listener(change);
    }
    this.externalOnStateChange?.(change);
  }
}

/** Audit-friendly event name for a state change, e.g. `safety.halted`. */
export function safetyStateEventName(to: SafetyStateName): string {
  switch (to) {
    case 'NORMAL':
      return 'safety.resumed';
    case 'RESTRICTED':
      return 'safety.restricted';
    case 'HALTED':
      return 'safety.halted';
    case 'ESTOP_REQUESTED':
      return 'safety.estop_requested';
    case 'FAULTED':
      return 'safety.faulted';
  }
}
