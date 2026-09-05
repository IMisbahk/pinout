import type { Device } from '../device.js';
import { DeviceError } from '../errors.js';
import {
  assertGpioPin,
  assertEsp32WritePin,
  assertSafeLevel,
  assertPolarity,
  type GpioPolarity,
  type GpioSafeLevel,
} from '../drivers/esp32/pins.js';
import type { BackendInvocationContext, DeviceBackend } from './types.js';

export interface OutputSafeConfig {
  pin: number;
  safeLevel?: GpioSafeLevel | undefined;
  polarity?: GpioPolarity | undefined;
}

export interface ProtocolDeviceBackendOptions {
  autoHeartbeat?: boolean | undefined;
  heartbeatIntervalMs?: number | undefined;
  watchdogTimeoutMs?: number | undefined;
  requireWatchdog?: boolean | undefined;
  outputs?: OutputSafeConfig[] | undefined;
  autoArm?: boolean | undefined;
}

export class ProtocolDeviceBackend implements DeviceBackend {
  readonly kind = 'protocol' as const;
  private state: 'disarmed' | 'armed' | 'tripped' = 'disarmed';
  private tripReason: string | undefined = undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined = undefined;
  private readonly watchdogConfig = { enabled: true, timeoutMs: 1000 };
  private readonly configuredOutputs = new Map<
    number,
    { safeLevel: GpioSafeLevel; polarity: GpioPolarity }
  >();
  private readonly cleanupListener: (() => void) | undefined;

  constructor(
    private readonly device: Device,
    private readonly options: ProtocolDeviceBackendOptions = {},
  ) {
    if (typeof options.watchdogTimeoutMs === 'number') {
      this.watchdogConfig.timeoutMs = options.watchdogTimeoutMs;
    }
    if (options.outputs) {
      for (const out of options.outputs) {
        const pin = assertGpioPin(out.pin);
        assertEsp32WritePin(pin);
        const safeLevel = out.safeLevel !== undefined ? assertSafeLevel(out.safeLevel) : 'low';
        const polarity = out.polarity !== undefined ? assertPolarity(out.polarity) : 'active-high';
        this.configuredOutputs.set(pin, { safeLevel, polarity });
      }
    }

    const tripHandler = (payload: Record<string, unknown>): void => {
      this.state = 'tripped';
      this.tripReason = typeof payload.reason === 'string' ? payload.reason : 'WATCHDOG_EXPIRED';
      this.stopHeartbeat();
    };

    this.device.on('device.tripped', tripHandler);
    this.cleanupListener = () => {
      this.device.off('device.tripped', tripHandler);
    };
  }

  subscribe(_handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    return () => undefined;
  }

  async initializeOutputs(): Promise<void> {
    if (!this.device.supports('gpio.configSafeState')) {
      return;
    }
    for (const [pin, config] of this.configuredOutputs) {
      await this.device.configSafeState(pin, config.safeLevel, config.polarity);
    }
  }

  async arm(options?: {
    timeoutMs?: number | undefined;
    heartbeatIntervalMs?: number | undefined;
    requireWatchdog?: boolean | undefined;
  }): Promise<Record<string, unknown>> {
    const requireWatchdog = options?.requireWatchdog ?? this.options.requireWatchdog ?? false;
    const supportsWatchdog =
      this.device.supports('sys.arm') ||
      this.device.hasFeature('watchdog') ||
      this.device.hasFeature('arming');

    if (requireWatchdog && !supportsWatchdog) {
      throw new DeviceError(
        'WATCHDOG_NOT_SUPPORTED',
        'Device firmware does not advertise watchdog/arming support.',
      );
    }

    await this.initializeOutputs();

    if (this.device.supports('sys.arm')) {
      const armPayload: { timeoutMs?: number } = {};
      const timeoutMs = options?.timeoutMs ?? this.options.watchdogTimeoutMs;
      if (timeoutMs !== undefined) {
        armPayload.timeoutMs = timeoutMs;
      }
      const result = await this.device.arm(armPayload);
      this.state = 'armed';
      this.tripReason = undefined;
      if (typeof result.timeoutMs === 'number') {
        this.watchdogConfig.timeoutMs = result.timeoutMs;
      }
      this.startHeartbeat(options?.heartbeatIntervalMs);
      return result;
    }

    this.state = 'armed';
    this.tripReason = undefined;
    return { armed: true, state: 'armed', legacy: true };
  }

  async disarm(): Promise<Record<string, unknown>> {
    this.stopHeartbeat();
    if (this.device.supports('sys.disarm')) {
      const result = await this.device.disarm();
      this.state = 'disarmed';
      this.tripReason = undefined;
      return result;
    }
    if (this.device.supports('gpio.stopAll')) {
      const stoppedPins = await this.device.gpio.stopAll();
      this.state = 'disarmed';
      this.tripReason = undefined;
      return { armed: false, state: 'disarmed', stoppedPins };
    }
    this.state = 'disarmed';
    this.tripReason = undefined;
    return { armed: false, state: 'disarmed' };
  }

  async configSafeState(
    pin: number,
    safeLevel: GpioSafeLevel = 'low',
    polarity: GpioPolarity = 'active-high',
  ): Promise<Record<string, unknown>> {
    assertEsp32WritePin(pin);
    this.configuredOutputs.set(pin, { safeLevel, polarity });
    if (this.device.supports('gpio.configSafeState')) {
      return this.device.configSafeState(pin, safeLevel, polarity);
    }
    return { pin, safeLevel, polarity };
  }

  async invoke(
    action: string,
    payload: Record<string, unknown>,
    context?: BackendInvocationContext,
  ): Promise<Record<string, unknown>> {
    return this.device.invoke(action, payload, context?.signal ? { signal: context.signal } : {});
  }

  async close(): Promise<void> {
    this.stopHeartbeat();
    this.cleanupListener?.();
    await this.device.close();
  }

  getDevice(): Device {
    return this.device;
  }

  getOperationalState(): Record<string, unknown> {
    return {
      firmware: this.device.info.firmware,
      version: this.device.info.version,
      protocol: this.device.info.protocol,
      features: this.device.info.features ?? [],
      state: this.state,
      armed: this.state === 'armed',
      disarmed: this.state === 'disarmed',
      tripped: this.state === 'tripped',
      ...(this.tripReason ? { tripReason: this.tripReason } : {}),
      watchdog: {
        enabled: this.watchdogConfig.enabled,
        timeoutMs: this.watchdogConfig.timeoutMs,
      },
    };
  }

  async safeState(): Promise<Record<string, unknown>> {
    this.stopHeartbeat();
    if (this.device.supports('sys.disarm')) {
      await this.device.disarm().catch(() => undefined);
    }
    if (!this.device.supports('gpio.stopAll')) {
      this.state = 'disarmed';
      return { applied: false, reason: 'safe-state-not-supported' };
    }
    const stoppedPins = await this.device.gpio.stopAll();
    this.state = 'disarmed';
    return { applied: true, stoppedPins };
  }

  private startHeartbeat(intervalMs?: number): void {
    if (this.options.autoHeartbeat === false) {
      return;
    }
    if (!this.device.supports('watchdog.kick')) {
      return;
    }
    this.stopHeartbeat();
    const interval =
      intervalMs ??
      this.options.heartbeatIntervalMs ??
      Math.max(50, Math.floor(this.watchdogConfig.timeoutMs / 2));

    this.heartbeatTimer = setInterval(async () => {
      if (this.state !== 'armed') {
        this.stopHeartbeat();
        return;
      }
      try {
        await this.device.kickWatchdog();
      } catch (error) {
        if (error instanceof DeviceError) {
          if (error.code === 'WATCHDOG_TRIPPED') {
            this.state = 'tripped';
            this.tripReason = 'WATCHDOG_EXPIRED';
            this.stopHeartbeat();
          } else if (error.code === 'NOT_ARMED') {
            this.state = 'disarmed';
            this.stopHeartbeat();
          }
        }
      }
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}
