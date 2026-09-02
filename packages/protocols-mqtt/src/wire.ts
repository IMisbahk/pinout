/**
 * Minimal MQTT 3.1.1 wire codec (zero dependencies).
 *
 * Covers the packet subset a mapping module needs: CONNECT/CONNACK,
 * PUBLISH (QoS 0/1), PUBACK, SUBSCRIBE/SUBACK, PINGREQ/PINGRESP, DISCONNECT.
 * Remaining-length varint encoding per the MQTT 3.1.1 spec.
 */

export type MqttPacketType =
  | 'CONNECT' | 'CONNACK' | 'PUBLISH' | 'PUBACK' | 'SUBSCRIBE'
  | 'SUBACK' | 'PINGREQ' | 'PINGRESP' | 'DISCONNECT';

const TYPE_BY_NUMBER: Record<number, MqttPacketType> = {
  1: 'CONNECT', 2: 'CONNACK', 3: 'PUBLISH', 4: 'PUBACK', 8: 'SUBSCRIBE',
  9: 'SUBACK', 12: 'PINGREQ', 13: 'PINGRESP', 14: 'DISCONNECT',
};

const TYPE_NUMBERS: Record<MqttPacketType, number> = {
  CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, SUBSCRIBE: 8,
  SUBACK: 9, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14,
};

export function encodeRemainingLength(length: number): Buffer {
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
  const flags = 0x02; // clean session
  const payloadParts: Buffer[] = [encodeMqttString(options.clientId)];
  let variableHeader = Buffer.concat([
    encodeMqttString('MQTT'),
    Buffer.from([0x04]), // protocol level 4 (3.1.1)
    Buffer.from([flags]),
    Buffer.from([0x00, options.keepAliveSeconds ?? 60]),
  ]);
  if (options.username !== undefined) {
    variableHeader = Buffer.concat([variableHeader, encodeMqttString(options.username)]);
    void flags;
  }
  if (options.password !== undefined) {
    variableHeader = Buffer.concat([variableHeader, encodeMqttString(options.password)]);
  }
  const body = Buffer.concat([variableHeader, ...payloadParts]);
  return Buffer.concat([Buffer.from([TYPE_NUMBERS.CONNECT << 4]), encodeRemainingLength(body.length), body]);
}

export function encodeSubscribe(packetId: number, topicFilter: string, qos = 0): Buffer {
  const body = Buffer.concat([
    Buffer.from([0x00, packetId]),
    encodeMqttString(topicFilter),
    Buffer.from([qos]),
  ]);
  return Buffer.concat([Buffer.from([(TYPE_NUMBERS.SUBSCRIBE << 4) | 0x02]), encodeRemainingLength(body.length), body]);
}

export function encodePublish(topic: string, payload: string | Buffer, packetId?: number, qos = 0): Buffer {
  const topicBytes = encodeMqttString(topic);
  const body =
    qos === 0
      ? Buffer.concat([topicBytes, Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8')])
      : Buffer.concat([
          topicBytes,
          Buffer.from([0x00, packetId ?? 1]),
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
export function tryDecodePacket(buffer: Buffer): { packet: MqttPacket; consumed: number } | undefined {
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
  }
  const total = index + value;
  if (buffer.length < total) return undefined;
  const body = buffer.subarray(index, total);

  const packet: MqttPacket = { type };
  switch (type) {
    case 'CONNACK': {
      if (body[1] !== undefined) packet.connackReturnCode = body[1];
      break;
    }
    case 'PUBLISH': {
      const qos = (buffer[0]! >> 1) & 0x03;
      packet.qos = qos;
      const topicLength = body.readUInt16BE(0);
      packet.topic = body.subarray(2, 2 + topicLength).toString('utf8');
      let payloadOffset = 2 + topicLength;
      if (qos > 0) {
        packet.packetId = body.readUInt16BE(payloadOffset);
        payloadOffset += 2;
      }
      packet.payload = Buffer.from(body.subarray(payloadOffset));
      break;
    }
    case 'PUBACK':
    case 'SUBACK':
    case 'SUBSCRIBE': {
      packet.packetId = body.readUInt16BE(0);
      if (type === 'SUBACK') {
        packet.returnCodes = [...body.subarray(2)];
      } else {
        // SUBSCRIBE payload: repeated (topic string, qos byte) pairs.
        const filters: string[] = [];
        let offset = 2;
        while (offset + 2 <= body.length) {
          const length = body.readUInt16BE(offset);
          offset += 2;
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
    case 'SUBSCRIBE':
      break;
  }
  return { packet, consumed: total };
}

export { TYPE_NUMBERS };
