import { AbortedError, ValidationError } from '../../errors.js';
import type { Device } from '../../device.js';
import { connect } from '../../connect.js';
import type { Transport } from '../../types.js';
import type { BackendInvocationContext, DeviceBackend } from '../../runtime/types.js';

export interface Esp32CoffeeMachineOptions {
  transport: Transport;
  heaterPin: number;
  pumpPin: number;
  waterLevelPin: number;
  temperatureAdcPin: number;
  temperatureScaleCPerCount: number;
  temperatureOffsetC?: number;
  waterOkLevel?: boolean;
  brewDurationMs?: number;
}

export class Esp32CoffeeMachineBackend implements DeviceBackend {
  readonly kind = 'protocol' as const;
  private readonly listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();

  private constructor(
    private readonly device: Device,
    private readonly options: Esp32CoffeeMachineOptions,
  ) {}

  static async create(options: Esp32CoffeeMachineOptions): Promise<Esp32CoffeeMachineBackend> {
    validateOptions(options);
    return new Esp32CoffeeMachineBackend(await connect({ transport: options.transport }), options);
  }

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    await this.safeState().catch(() => undefined);
    this.listeners.clear();
    await this.device.close();
  }

  async safeState(): Promise<Record<string, unknown>> {
    const stoppedPins = await this.device.gpio.stopAll();
    this.emit('safe_state.applied', { stoppedPins });
    return { pump: 'off', heater: false, stoppedPins };
  }

  async invoke(
    action: string,
    payload: Record<string, unknown>,
    context: BackendInvocationContext = {},
  ): Promise<Record<string, unknown>> {
    switch (action) {
      case 'water_level.read':
        return { state: (await this.waterOk(context.signal)) ? 'ok' : 'low' };
      case 'temperature.read': {
        const raw = await this.device.invoke(
          'gpio.analogRead',
          { pin: this.options.temperatureAdcPin },
          context.signal ? { signal: context.signal } : {},
        );
        return {
          temperature:
            Number(raw.value) * this.options.temperatureScaleCPerCount +
            (this.options.temperatureOffsetC ?? 0),
        };
      }
      case 'heater.set':
        await this.write(this.options.heaterPin, payload.enabled === true, context.signal);
        return { enabled: payload.enabled === true };
      case 'pump.start':
        await this.assertWater(context.signal);
        await this.write(this.options.pumpPin, true, context.signal);
        return { pump: 'running' };
      case 'pump.stop':
        await this.write(this.options.pumpPin, false, context.signal);
        return { pump: 'off' };
      case 'brew.start':
        return this.brew(Number(payload.shots ?? 1), context);
      case 'brew.stop':
        await this.safeState();
        return { status: 'cancelled', pump: 'off', heater: false };
      case 'status.read': {
        const [water, temperature] = await Promise.all([
          this.invoke('water_level.read', {}, context),
          this.invoke('temperature.read', {}, context),
        ]);
        return {
          status: 'ready',
          water_level: water,
          temperature: temperature.temperature,
          heater: false,
          pump: 'off',
          brew: { status: 'idle', progress: 0 },
        };
      }
      default:
        throw new ValidationError(`Unsupported coffee-machine capability '${action}'.`);
    }
  }

  private async brew(
    shots: number,
    context: BackendInvocationContext,
  ): Promise<Record<string, unknown>> {
    await this.assertWater(context.signal);
    await this.write(this.options.heaterPin, true, context.signal);
    await this.write(this.options.pumpPin, true, context.signal);
    const duration = (this.options.brewDurationMs ?? 1000) * shots;
    const startedAt = Date.now();
    context.reportProgress?.(0, 'brew started');
    try {
      while (Date.now() - startedAt < duration) {
        await abortableDelay(Math.min(100, duration - (Date.now() - startedAt)), context.signal);
        context.reportProgress?.(Math.min(1, (Date.now() - startedAt) / duration), 'brewing');
      }
      await this.safeState();
      context.reportProgress?.(1, 'brew completed');
      return { status: 'completed', progress: 1 };
    } catch (error) {
      await this.safeState().catch(() => undefined);
      throw error;
    }
  }

  private async waterOk(signal?: AbortSignal): Promise<boolean> {
    const result = await this.device.invoke(
      'gpio.read',
      { pin: this.options.waterLevelPin },
      signal ? { signal } : {},
    );
    return result.value === (this.options.waterOkLevel ?? true);
  }

  private async assertWater(signal?: AbortSignal): Promise<void> {
    if (!(await this.waterOk(signal))) {
      throw new ValidationError('Coffee-machine water interlock is low.');
    }
  }

  private async write(pin: number, value: boolean, signal?: AbortSignal): Promise<void> {
    await this.device.invoke('gpio.write', { pin, value }, signal ? { signal } : {});
  }

  private emit(event: string, payload: Record<string, unknown>): void {
    for (const listener of this.listeners) listener(event, payload);
  }
}

function validateOptions(options: Esp32CoffeeMachineOptions): void {
  for (const key of ['heaterPin', 'pumpPin', 'waterLevelPin', 'temperatureAdcPin'] as const) {
    if (!Number.isInteger(options[key])) throw new ValidationError(`${key} must be an integer.`);
  }
  if (!Number.isFinite(options.temperatureScaleCPerCount)) {
    throw new ValidationError('temperatureScaleCPerCount must be configured explicitly.');
  }
  if ((options.brewDurationMs ?? 1000) <= 0) {
    throw new ValidationError('brewDurationMs must be positive.');
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AbortedError('Brew operation aborted.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      },
      Math.max(0, ms),
    );
    const abort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new AbortedError('Brew operation aborted.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export const createEsp32CoffeeMachineBackend = (options: Esp32CoffeeMachineOptions) =>
  Esp32CoffeeMachineBackend.create(options);
