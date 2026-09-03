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
  encodePuback,
  encodeSubscribe,
  tryDecodePacket,
  type MqttPacket,
} from './wire.js';
import { topicMatches } from './mapping.js';

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
  private readonly subscriptions = new Map<string, MessageHandler>();
  private readonly activePacketIds = new Set<number>();
  private connectPromise: Promise<void> | undefined;
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  private pingPromise: Promise<void> | undefined;
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
    if (this.closed) throw new MqttError('MQTT_CLOSED', 'Create a new client after closing.');
    if (this.started) return;
    this.connectPromise ??= this.openConnection();
    return this.connectPromise;
  }

  private async openConnection(): Promise<void> {
    const bytes = encodeConnect({
      clientId: this.clientId,
      keepAliveSeconds: this.keepAliveSeconds,
      ...(this.username !== undefined ? { username: this.username } : {}),
      ...(this.password !== undefined ? { password: this.password } : {}),
    });
    try {
      await this.transport.open();
      void this.consume();
      const response = await this.sendAwait(bytes, (packet) => packet.type === 'CONNACK');
      if (response.connackReturnCode !== 0) {
        throw new MqttError(
          'MQTT_CONNECTION_REFUSED',
          `Broker refused connection (${response.connackReturnCode}).`,
        );
      }
      this.started = true;
      if (this.keepAliveSeconds > 0) {
        this.keepAliveTimer = setInterval(() => {
          void this.ping().catch(() => this.abortConnection());
        }, this.keepAliveSeconds * 500);
        this.keepAliveTimer.unref();
      }
    } catch (error) {
      await this.abortConnection();
      throw error;
    }
  }

  async subscribe(topicFilter: string, handler: MessageHandler, qos = 0): Promise<void> {
    this.assertConnected();
    const packetId = this.allocatePacketId();
    const previous = this.subscriptions.get(topicFilter);
    try {
      const bytes = encodeSubscribe(packetId, topicFilter, qos);
      this.subscriptions.set(topicFilter, handler);
      const response = await this.sendAwait(
        bytes,
        (packet) => packet.type === 'SUBACK' && packet.packetId === packetId,
      );
      if (response.returnCodes?.length !== 1 || ![0, 1].includes(response.returnCodes[0]!)) {
        throw new MqttError(
          'MQTT_SUBSCRIPTION_REFUSED',
          `Broker refused subscription '${topicFilter}'.`,
        );
      }
    } catch (error) {
      if (previous) this.subscriptions.set(topicFilter, previous);
      else this.subscriptions.delete(topicFilter);
      throw error;
    } finally {
      this.activePacketIds.delete(packetId);
    }
  }

  /** Publish with QoS 0 (fire-and-forget) or QoS 1 (waits for PUBACK). */
  async publish(topic: string, payload: string | Buffer, qos = 0): Promise<void> {
    this.assertConnected();
    if (qos === 0) {
      await this.transport.write(encodePublish(topic, payload));
      return;
    }
    const packetId = this.allocatePacketId();
    try {
      await this.sendAwait(
        encodePublish(topic, payload, packetId, qos),
        (packet) => packet.type === 'PUBACK' && packet.packetId === packetId,
      );
    } finally {
      this.activePacketIds.delete(packetId);
    }
  }

  async ping(): Promise<void> {
    this.assertConnected();
    this.pingPromise ??= this.sendAwait(encodePingReq(), (packet) => packet.type === 'PINGRESP')
      .then(() => undefined)
      .finally(() => {
        this.pingPromise = undefined;
      });
    return this.pingPromise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.keepAliveTimer);
    try {
      await this.transport.write(encodeDisconnect());
    } catch {
      // best-effort disconnect
    }
    await this.transport.close();
  }

  // ---------------------------------------------------------------------------

  private allocatePacketId(): number {
    for (let count = 0; count < 65535; count += 1) {
      const id = this.nextPacketId;
      this.nextPacketId = (this.nextPacketId % 65535) + 1;
      if (this.activePacketIds.has(id)) continue;
      this.activePacketIds.add(id);
      return id;
    }
    throw new MqttError('MQTT_INFLIGHT_LIMIT', 'All packet identifiers are in flight.');
  }

  private assertConnected(): void {
    if (!this.started || this.closed)
      throw new MqttError('MQTT_CLOSED', 'MQTT client is not connected.');
  }

  private async abortConnection(): Promise<void> {
    this.closed = true;
    clearInterval(this.keepAliveTimer);
    try {
      await this.transport.close();
    } catch {
      /* Already disconnected. */
    }
  }

  private async sendAwait(
    bytes: Buffer,
    predicate: (packet: MqttPacket) => boolean,
  ): Promise<MqttPacket> {
    const deadline = Date.now() + this.timeoutMs;
    if (this.closed) throw new MqttError('MQTT_CLOSED', 'MQTT transport is closed.');
    await this.transport.write(bytes);
    for (;;) {
      this.drainRawBuffer();
      const index = this.controlQueue.findIndex(predicate);
      if (index !== -1) {
        const [matched] = this.controlQueue.splice(index, 1);
        return matched!;
      }
      if (Date.now() > deadline) {
        await this.abortConnection();
        throw new MqttError(
          'MQTT_TIMEOUT',
          `No matching MQTT response within ${this.timeoutMs}ms.`,
        );
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
    if (buffered.length > 1024 * 1024) {
      throw new MqttError(
        'MQTT_PACKET_TOO_LARGE',
        'Buffered MQTT data exceeds the 1 MiB client limit.',
      );
    }
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
        if (this.controlQueue.length >= 65535)
          throw new MqttError('MQTT_QUEUE_FULL', 'Too many unclaimed control packets.');
        this.controlQueue.push(decoded.packet);
      }
    }
  }

  private deliverIncoming(packet: MqttPacket): void {
    if (packet.topic !== undefined && packet.payload !== undefined) {
      for (const [filter, handler] of this.subscriptions) {
        if (topicMatches(filter, packet.topic)) handler(packet.topic, packet.payload);
      }
      if (packet.qos === 1 && packet.packetId !== undefined) {
        // QoS 1: acknowledge.
        void this.transport
          .write(encodePuback(packet.packetId))
          .catch(() => this.abortConnection());
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
      // Parse, handler, and transport failures terminate this session.
    } finally {
      await this.abortConnection();
    }
  }
}
