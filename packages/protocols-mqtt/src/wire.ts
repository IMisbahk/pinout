/**
 * Minimal MQTT 3.1.1 wire codec (zero dependencies).
 *
 * Covers the packet subset a mapping module needs: CONNECT/CONNACK,
 * PUBLISH (QoS 0/1), PUBACK, SUBSCRIBE/SUBACK, PINGREQ/PINGRESP, DISCONNECT.
 * Remaining-length varint encoding per the MQTT 3.1.1 spec.
 */
import { MqttError } from './errors.js';

export type MqttPacketType =
  | 'CONNECT'
  | 'CONNACK'
  | 'PUBLISH'
  | 'PUBACK'
  | 'SUBSCRIBE'
  | 'SUBACK'
  | 'PINGREQ'
  | 'PINGRESP'
  | 'DISCONNECT';

const TYPE_BY_NUMBER: Record<number, MqttPacketType> = {
  1: 'CONNECT',
  2: 'CONNACK',
  3: 'PUBLISH',
  4: 'PUBACK',
  8: 'SUBSCRIBE',
  9: 'SUBACK',
  12: 'PINGREQ',
  13: 'PINGRESP',
  14: 'DISCONNECT',
};

const TYPE_NUMBERS: Record<MqttPacketType, number> = {
  CONNECT: 1,
  CONNACK: 2,
  PUBLISH: 3,
  PUBACK: 4,
  SUBSCRIBE: 8,
  SUBACK: 9,
  PINGREQ: 12,
  PINGRESP: 13,
  DISCONNECT: 14,
};

export function encodeRemainingLength(length: number): Buffer {
  if (!Number.isInteger(length) || length < 0 || length > 268435455) {
    throw new MqttError(
      'MQTT_INVALID_LENGTH',
      'Remaining length must be an integer from 0 to 268435455.',
    );
  }
  const bytes: number[] = [];
  let remaining = length;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function encodeMqttString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const header = Buffer.alloc(2);
  header.writeUInt16BE(bytes.length);
  return Buffer.concat([header, bytes]);
}

export interface ConnectOptions {
  clientId: string;
  keepAliveSeconds?: number;
  username?: string;
  password?: string;
  cleanSession?: boolean;
}

export function encodeConnect(options: ConnectOptions): Buffer {
  let flags = options.cleanSession === false ? 0 : 0x02;
  if (!options.clientId && options.cleanSession === false) {
    throw new MqttError('MQTT_INVALID_CLIENT_ID', 'Persistent sessions require a client ID.');
  }
  if (options.password !== undefined && options.username === undefined) {
    throw new MqttError('MQTT_INVALID_CREDENTIALS', 'A password requires a username.');
  }
  const payloadParts: Buffer[] = [encodeMqttString(options.clientId)];
  if (options.username !== undefined) {
    flags |= 0x80;
    payloadParts.push(encodeMqttString(options.username));
  }
  if (options.password !== undefined) {
    flags |= 0x40;
    payloadParts.push(encodeMqttString(options.password));
  }
  const variableHeader = Buffer.concat([
    encodeMqttString('MQTT'),
    Buffer.from([0x04]), // protocol level 4 (3.1.1)
    Buffer.from([flags]),
    encodeUint16(options.keepAliveSeconds ?? 60, true),
  ]);
  const body = Buffer.concat([variableHeader, ...payloadParts]);
  return Buffer.concat([
    Buffer.from([TYPE_NUMBERS.CONNECT << 4]),
    encodeRemainingLength(body.length),
    body,
  ]);
}

export function encodeSubscribe(packetId: number, topicFilter: string, qos = 0): Buffer {
  validateQos(qos);
  validateTopicFilter(topicFilter);
  const body = Buffer.concat([
    encodeUint16(packetId),
    encodeMqttString(topicFilter),
    Buffer.from([qos]),
  ]);
  return Buffer.concat([
    Buffer.from([(TYPE_NUMBERS.SUBSCRIBE << 4) | 0x02]),
    encodeRemainingLength(body.length),
    body,
  ]);
}

export function encodePublish(
  topic: string,
  payload: string | Buffer,
  packetId?: number,
  qos = 0,
): Buffer {
  validateQos(qos);
  if (!topic || /[+#]/.test(topic) || topic.includes('\u0000')) {
    throw new MqttError(
      'MQTT_INVALID_TOPIC',
      'Publish topics must be nonempty and contain no wildcards or nulls.',
    );
  }
  const topicBytes = encodeMqttString(topic);
  const body =
    qos === 0
      ? Buffer.concat([
          topicBytes,
          Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8'),
        ])
      : Buffer.concat([
          topicBytes,
          encodeUint16(packetId ?? 1),
          Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8'),
        ]);
  const header = (TYPE_NUMBERS.PUBLISH << 4) | (qos === 0 ? 0x00 : 0x02);
  return Buffer.concat([Buffer.from([header]), encodeRemainingLength(body.length), body]);
}

export function encodePingReq(): Buffer {
  return Buffer.from([TYPE_NUMBERS.PINGREQ << 4, 0]);
}

export function encodeDisconnect(): Buffer {
  return Buffer.from([TYPE_NUMBERS.DISCONNECT << 4, 0]);
}

export function encodePuback(packetId: number): Buffer {
  return Buffer.concat([Buffer.from([0x40, 2]), encodeUint16(packetId)]);
}

function encodeUint16(value: number, allowZero = false): Buffer {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65535) {
    throw new MqttError('MQTT_INVALID_INTEGER', 'Value is outside the MQTT uint16 range.');
  }
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
}

function validateQos(qos: number): void {
  if (qos !== 0 && qos !== 1) {
    throw new MqttError('MQTT_UNSUPPORTED_QOS', 'This client supports QoS 0 and 1 only.');
  }
}

export function validateTopicFilter(filter: string): void {
  const parts = filter.split('/');
  if (
    !filter ||
    filter.includes('\u0000') ||
    parts.some(
      (part, i) =>
        (part.includes('#') && (part !== '#' || i !== parts.length - 1)) ||
        (part.includes('+') && part !== '+'),
    )
  ) {
    throw new MqttError('MQTT_INVALID_TOPIC', 'Invalid MQTT topic filter.');
  }
}

export interface MqttPacket {
  type: MqttPacketType;
  /** For PUBLISH: the topic. */
  topic?: string;
  /** For PUBLISH: the application payload. */
  payload?: Buffer;
  /** PUBLISH QoS. */
  qos?: number;
  /** Packet identifier for QoS 1 flows / SUBACK. */
  packetId?: number;
  /** SUBACK return codes. */
  returnCodes?: number[];
  /** SUBSCRIBE topic filters. */
  topicFilters?: string[];
  /** CONNACK session-present + return code. */
  connackReturnCode?: number;
}

/** Extract one packet from the head of `buffer`; returns bytes consumed. */
export function tryDecodePacket(
  buffer: Buffer,
): { packet: MqttPacket; consumed: number } | undefined {
  if (buffer.length < 2) return undefined;
  const typeNumber = buffer[0]! >> 4;
  const typeName = TYPE_BY_NUMBER[typeNumber];
  if (typeName === undefined) return undefined;
  const type: MqttPacketType = typeName;
  // Decode remaining length varint.
  let multiplier = 1;
  let value = 0;
  let index = 1;
  for (;;) {
    if (index >= buffer.length) return undefined;
    const byte = buffer[index]!;
    value += (byte & 0x7f) * multiplier;
    multiplier *= 128;
    index += 1;
    if ((byte & 0x80) === 0) break;
    if (index > 4) return undefined;
  }
  const total = index + value;
  if (buffer.length < total) return undefined;
  const body = buffer.subarray(index, total);

  const packet: MqttPacket = { type };
  switch (type) {
    case 'CONNACK': {
      if (body.length !== 2 || body[1]! > 5 || body[0]! > 1) return undefined;
      packet.connackReturnCode = body[1]!;
      break;
    }
    case 'PUBLISH': {
      // Bounds-check every read: truncated/hostile packets must yield
      // undefined (treated as garbage), never a RangeError.
      if (body.length < 2) return undefined;
      const qos = (buffer[0]! >> 1) & 0x03;
      if (qos > 1) return undefined;
      packet.qos = qos;
      const topicLength = body.readUInt16BE(0);
      if (2 + topicLength > body.length) return undefined;
      packet.topic = body.subarray(2, 2 + topicLength).toString('utf8');
      let payloadOffset = 2 + topicLength;
      if (qos > 0) {
        if (payloadOffset + 2 > body.length) return undefined;
        packet.packetId = body.readUInt16BE(payloadOffset);
        payloadOffset += 2;
      }
      packet.payload = Buffer.from(body.subarray(payloadOffset));
      break;
    }
    case 'PUBACK':
    case 'SUBACK':
    case 'SUBSCRIBE': {
      if (body.length < 2) return undefined;
      packet.packetId = body.readUInt16BE(0);
      if (packet.packetId === 0) return undefined;
      if (type === 'SUBACK') {
        if (body.length < 3) return undefined;
        packet.returnCodes = [...body.subarray(2)];
      } else if (type === 'SUBSCRIBE') {
        // SUBSCRIBE payload: repeated (topic string, qos byte) pairs.
        const filters: string[] = [];
        let offset = 2;
        while (offset + 2 <= body.length) {
          const length = body.readUInt16BE(offset);
          offset += 2;
          if (offset + length >= body.length) return undefined;
          filters.push(body.subarray(offset, offset + length).toString('utf8'));
          offset += length + 1; // trailing qos byte
        }
        packet.topicFilters = filters;
      }
      break;
    }
    case 'PINGREQ':
    case 'PINGRESP':
    case 'DISCONNECT':
    case 'CONNECT':
      break;
  }
  return { packet, consumed: total };
}

export { TYPE_NUMBERS };
