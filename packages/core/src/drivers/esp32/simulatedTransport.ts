import { ByteQueue } from '../../transports/byteQueue.js';
import { encodeLine } from '../../lineReader.js';
import { encodeEvent, encodeFailure, encodeResponse, parseLine } from '../../protocol.js';
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
    let message;
    try {
      message = parseLine(line);
    } catch {
      this.emitError('invalid', 'INVALID_JSON', 'Request is not valid Pinout protocol JSON.');
      return;
    }

    if (message === null || !('action' in message)) {
      return;
    }

    try {
      const result = handleBridgeAction(message.action, message.payload, this.state);
      this.emitSuccess(message.id, result);
    } catch (error) {
      if (error instanceof DeviceError) {
        this.emitError(message.id, error.code, error.message);
        return;
      }
      this.emitError(
        message.id,
        'INTERNAL',
        error instanceof Error ? error.message : 'Internal simulator error.',
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
}
