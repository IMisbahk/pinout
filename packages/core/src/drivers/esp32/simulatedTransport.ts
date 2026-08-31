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
      this.emitSuccess(message.id, result);
      if (message.action === 'gpio.pulse') {
        this.schedulePulseRevert(result);
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

    setTimeout(() => {
      const wasWatched = this.state.watched.has(pin);
      this.state.levels.set(pin, previousValue);
      if (wasWatched) {
        this.emitEvent('gpio.changed', { pin, value: previousValue });
      }
    }, durationMs);
  }
}
