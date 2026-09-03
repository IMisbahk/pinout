import { ByteQueue } from '../../transports/byteQueue.js';
import { encodeLine } from '../../lineReader.js';
import {
  decodeLine,
  encodeEvent,
  encodeFailure,
  encodeResponse,
  maxProtocolLineBytes,
} from '../../protocol.js';
import type { Transport } from '../../types.js';
import { DeviceError } from '../../errors.js';
import { createGpioState, esp32BridgeInfo, handleBridgeAction } from './bridge.js';

export function simulatedEsp32(): Transport {
  return new SimulatedEsp32Transport();
}

class SimulatedEsp32Transport implements Transport {
  readonly kind = 'simulated-esp32';
  private readonly inbound = new ByteQueue();
  private readonly decoder = new TextDecoder();
  private writeBuffer = '';
  private readonly state = createGpioState();
  private readonly pulseTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private started = false;

  get readable(): AsyncIterable<Uint8Array> {
    return this.inbound;
  }

  async open(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.emitEvent('ready', { ...esp32BridgeInfo });
  }

  async close(): Promise<void> {
    for (const timer of this.pulseTimers.values()) clearTimeout(timer);
    this.pulseTimers.clear();
    this.state.watched.clear();
    this.inbound.close();
  }

  async write(data: Uint8Array): Promise<void> {
    this.writeBuffer += this.decoder.decode(data, { stream: true });
    let newlineAt = this.writeBuffer.indexOf('\n');
    while (newlineAt >= 0) {
      const line = this.writeBuffer.slice(0, newlineAt);
      this.writeBuffer = this.writeBuffer.slice(newlineAt + 1);
      this.handleLine(line);
      newlineAt = this.writeBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    if (new TextEncoder().encode(line).length >= maxProtocolLineBytes) {
      this.emitError('invalid', 'INVALID_MESSAGE', 'Request line is too long.');
      return;
    }

    const decoded = decodeLine(line);
    if (decoded.kind === 'ignore') {
      return;
    }
    if (decoded.kind === 'invalidJson') {
      this.emitError('invalid', 'INVALID_JSON', 'Request is not valid JSON.');
      return;
    }
    if (decoded.kind === 'invalidMessage') {
      this.emitError('invalid', 'INVALID_MESSAGE', decoded.message);
      return;
    }

    const message = decoded.value;
    if (!('action' in message)) {
      this.emitError('invalid', 'INVALID_MESSAGE', 'Request must include string id and action.');
      return;
    }

    try {
      const result = handleBridgeAction(message.action, message.payload, this.state, {
        emitEvent: (event, payload) => this.emitEvent(event, payload),
        schedule: (task, delayMs) => {
          setTimeout(task, delayMs);
        },
      });
      this.cancelSupersededPulses(message.action, result);
      this.emitSuccess(message.id, result);
      if (message.action === 'gpio.pulse') {
        this.schedulePulseRevert(result);
      } else if (message.action === 'gpio.stopAll') {
        for (const timer of this.pulseTimers.values()) clearTimeout(timer);
        this.pulseTimers.clear();
      }
    } catch (error) {
      if (error instanceof DeviceError) {
        this.emitError(message.id, error.code, error.message);
        return;
      }
      this.emitError(
        message.id,
        'INVALID_MESSAGE',
        error instanceof Error ? error.message : 'Request could not be processed.',
      );
    }
  }

  private emitEvent(event: string, payload: Record<string, unknown>): void {
    this.inbound.push(encodeLine(encodeEvent(event, payload)));
  }

  private emitSuccess(id: string, result: Record<string, unknown>): void {
    this.inbound.push(encodeLine(encodeResponse(id, result)));
  }

  private emitError(id: string, code: string, message: string): void {
    this.inbound.push(encodeLine(encodeFailure(id, code, message)));
  }

  private schedulePulseRevert(result: Record<string, unknown>): void {
    const pin = result.pin;
    const previousValue = result.previousValue;
    const durationMs = result.durationMs;
    if (
      typeof pin !== 'number' ||
      typeof previousValue !== 'boolean' ||
      typeof durationMs !== 'number'
    ) {
      return;
    }

    const existing = this.pulseTimers.get(pin);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      const wasWatched = this.state.watched.has(pin);
      this.state.levels.set(pin, previousValue);
      if (wasWatched) {
        this.emitEvent('gpio.changed', { pin, value: previousValue });
      }
      this.pulseTimers.delete(pin);
    }, durationMs);
    this.pulseTimers.set(pin, timer);
  }

  private cancelSupersededPulses(action: string, result: Record<string, unknown>): void {
    if (action === 'gpio.pulse' || action === 'gpio.stopAll') return;
    const outputActions = new Set([
      'gpio.mode',
      'gpio.write',
      'gpio.batchWrite',
      'gpio.toggle',
      'gpio.pwm',
      'gpio.servo',
      'gpio.motor',
      'i2c.begin',
      'spi.begin',
    ]);
    if (!outputActions.has(action)) return;

    const pins = new Set<number>();
    for (const key of [
      'pin',
      'pwmPin',
      'dirPin',
      'sda',
      'scl',
      'sck',
      'miso',
      'mosi',
      'chipSelect',
    ]) {
      if (typeof result[key] === 'number') pins.add(result[key]);
    }
    if (Array.isArray(result.writes)) {
      for (const write of result.writes) {
        if (
          write &&
          typeof write === 'object' &&
          typeof (write as { pin?: unknown }).pin === 'number'
        ) {
          pins.add((write as { pin: number }).pin);
        }
      }
    }
    for (const pin of pins) {
      const timer = this.pulseTimers.get(pin);
      if (timer) clearTimeout(timer);
      this.pulseTimers.delete(pin);
    }
  }
}
