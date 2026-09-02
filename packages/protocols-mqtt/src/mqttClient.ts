/**
 * MQTT 3.1.1 client over any Pinout Transport (TCP, loopback simulator, …).
 *
 * Subscribes receive PUBLISH packets via the `onMessage` handler; publishes
 * with QoS 1 await PUBACK. Connection-level failures surface as structured
 * MqttError codes.
 */
import type { Transport } from '@pinout/core';
import { MqttError } from './errors.js';
import {
  encodeConnect,
  encodeDisconnect,
  encodePingReq,
  encodePublish,
  encodeSubscribe,
  tryDecodePacket,
  type MqttPacket,
} from './wire.js';

export interface MqttClientOptions {
  transport: Transport;
  clientId: string;
  username?: string;
  password?: string;
  keepAliveSeconds?: number;
  timeoutMs?: number;
}

export type MessageHandler = (topic: string, payload: Buffer) => void;

export class MqttClient {
  private readonly transport: Transport;
  private readonly clientId: string;
  private readonly username: string | undefined;
  private readonly password: string | undefined;
  private readonly keepAliveSeconds: number;
  private readonly timeoutMs: number;
  private readonly rawBuffer: Buffer[] = [];
  /** Control packets (CONNACK/SUBACK/PUBACK/PINGRESP) awaiting a sender. */
  private readonly controlQueue: MqttPacket[] = [];
  private onMessage: MessageHandler | undefined;
  private packetIdCounter = 1;
  private started = false;
  private closed = false;
  private nextPacketId = 1;

  constructor(options: MqttClientOptions) {
    this.transport = options.transport;
    this.clientId = options.clientId;
    this.username = options.username;
    this.password = options.password;
    this.keepAliveSeconds = options.keepAliveSeconds ?? 60;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async connect(): Promise<void> {
    if (this.started) return;
    await this.transport.open();
    void this.consume();
    await this.sendAwait(
      encodeConnect({
        clientId: this.clientId,
        keepAliveSeconds: this.keepAliveSeconds,
        ...(this.username !== undefined ? { username: this.username } : {}),
        ...(this.password !== undefined ? { password: this.password } : {}),
      }),
      (packet) => packet.type === 'CONNACK',
    );
    this.started = true;
  }

  async subscribe(topicFilter: string, handler: MessageHandler, qos = 0): Promise<void> {
    this.onMessage = handler;
    const packetId = this.allocatePacketId();
    await this.sendAwait(encodeSubscribe(packetId, topicFilter, qos), (packet) => packet.type === 'SUBACK' && packet.packetId === packetId);
  }

  /** Publish with QoS 0 (fire-and-forget) or QoS 1 (waits for PUBACK). */
  async publish(topic: string, payload: string | Buffer, qos = 0): Promise<void> {
    if (qos === 0) {
      this.transport.write(encodePublish(topic, payload));
      return;
    }
    const packetId = this.allocatePacketId();
    await this.sendAwait(encodePublish(topic, payload, packetId, qos), (packet) => packet.type === 'PUBACK' && packet.packetId === packetId);
  }

  async ping(): Promise<void> {
    await this.sendAwait(encodePingReq(), (packet) => packet.type === 'PINGRESP');
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.transport.write(encodeDisconnect());
    } catch {
      // best-effort disconnect
    }
    await this.transport.close();
  }

  // ---------------------------------------------------------------------------

  private allocatePacketId(): number {
    const id = this.nextPacketId;
    this.nextPacketId = (this.nextPacketId % 65535) + 1;
    return id;
  }

  private async sendAwait(bytes: Buffer, predicate: (packet: MqttPacket) => boolean): Promise<MqttPacket> {
    const deadline = Date.now() + this.timeoutMs;
    await this.transport.write(bytes);
    for (;;) {
      this.drainRawBuffer();
      const index = this.controlQueue.findIndex(predicate);
      if (index !== -1) {
        const [matched] = this.controlQueue.splice(index, 1);
        return matched!;
      }
      if (Date.now() > deadline) {
        throw new MqttError('MQTT_TIMEOUT', `No matching MQTT response within ${this.timeoutMs}ms.`);
      }
      if (this.closed) {
        throw new MqttError('MQTT_CLOSED', 'Transport closed while awaiting an MQTT response.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  /** Parse raw transport bytes; PUBLISH is delivered immediately, control packets queue. */
  private drainRawBuffer(): void {
    const buffered = Buffer.concat(this.rawBuffer);
    this.rawBuffer.length = 0;
    let cursor = 0;
    while (cursor < buffered.length) {
      const decoded = tryDecodePacket(buffered.subarray(cursor));
      if (!decoded) {
        this.rawBuffer.push(buffered.subarray(cursor));
        break;
      }
      cursor += decoded.consumed;
      if (decoded.packet.type === 'PUBLISH') {
        this.deliverIncoming(decoded.packet);
      } else {
        this.controlQueue.push(decoded.packet);
      }
    }
  }

  private deliverIncoming(packet: MqttPacket): void {
    if (packet.topic !== undefined && packet.payload !== undefined) {
      this.onMessage?.(packet.topic, packet.payload);
      if (packet.qos === 1 && packet.packetId !== undefined) {
        // QoS 1: acknowledge.
        const ackBody = Buffer.from([0x00, packet.packetId]);
        this.transport.write(Buffer.from([(4 << 4), 0x02, ...ackBody]));
      }
    }
  }

  private async consume(): Promise<void> {
    try {
      for await (const chunk of this.transport.readable) {
        this.rawBuffer.push(Buffer.from(chunk));
        this.drainRawBuffer();
      }
    } catch {
      this.closed = true;
    }
  }
}
