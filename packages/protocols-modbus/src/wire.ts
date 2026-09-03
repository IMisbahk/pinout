/**
 * Modbus PDU/frame codec (spec v1 of the adapter).
 *
 * Implements the Modbus Application Protocol subset used by this adapter:
 * function codes 0x01–0x06, 0x0F, 0x10 over TCP (MBAP) and RTU (address +
 * PDU + CRC16). Exception responses are parsed into typed errors with stable
 * codes. No external dependencies.
 */

export type ModbusFunctionCode = 0x01 | 0x02 | 0x03 | 0x04 | 0x05 | 0x06 | 0x0f | 0x10;

export interface ModbusException {
  kind: 'exception';
  functionCode: number;
  exceptionCode: number;
}

export const EXCEPTION_NAMES: Record<number, string> = {
  0x01: 'ILLEGAL_FUNCTION',
  0x02: 'ILLEGAL_DATA_ADDRESS',
  0x03: 'ILLEGAL_DATA_VALUE',
  0x04: 'SERVER_DEVICE_FAILURE',
  0x05: 'ACKNOWLEDGE',
  0x06: 'SERVER_DEVICE_BUSY',
  0x08: 'MEMORY_PARITY_ERROR',
  0x0a: 'GATEWAY_PATH_UNAVAILABLE',
  0x0b: 'GATEWAY_TARGET_FAILED',
};

export class ModbusError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ModbusError';
    this.code = code;
  }
}

export function exceptionError(functionCode: number, exceptionCode: number): ModbusError {
  const name = EXCEPTION_NAMES[exceptionCode] ?? 'EXCEPTION';
  return new ModbusError(
    `MODBUS_EXCEPTION_${name}`,
    `Modbus exception ${exceptionCode} (${name}) in response to function 0x${functionCode.toString(16).padStart(2, '0')}.`,
  );
}

// ---------------------------------------------------------------------------
// CRC16 (RTU) — Modbus polynomial 0xA001, reflected, init 0xFFFF
// ---------------------------------------------------------------------------

export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ 0xa001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc;
}

// ---------------------------------------------------------------------------
// PDU encode/decode
// ---------------------------------------------------------------------------

export function encodeReadRequest(
  functionCode: 0x01 | 0x02 | 0x03 | 0x04,
  startAddress: number,
  quantity: number,
): Uint8Array {
  assertQuantity(functionCode, quantity);
  const pdu = new Uint8Array(5);
  pdu[0] = functionCode;
  pdu[1] = (startAddress >> 8) & 0xff;
  pdu[2] = startAddress & 0xff;
  pdu[3] = (quantity >> 8) & 0xff;
  pdu[4] = quantity & 0xff;
  return pdu;
}

export function encodeWriteSingle(
  functionCode: 0x05 | 0x06,
  address: number,
  value: number,
): Uint8Array {
  const pdu = new Uint8Array(5);
  pdu[0] = functionCode;
  pdu[1] = (address >> 8) & 0xff;
  pdu[2] = address & 0xff;
  pdu[3] = (value >> 8) & 0xff;
  pdu[4] = value & 0xff;
  return pdu;
}

export function encodeWriteMultipleCoils(address: number, values: boolean[]): Uint8Array {
  const byteCount = Math.ceil(values.length / 8);
  const pdu = new Uint8Array(6 + byteCount);
  pdu[0] = 0x0f;
  pdu[1] = (address >> 8) & 0xff;
  pdu[2] = address & 0xff;
  pdu[3] = (values.length >> 8) & 0xff;
  pdu[4] = values.length & 0xff;
  pdu[5] = byteCount;
  for (const [index, value] of values.entries()) {
    if (value) {
      const byteIndex = 6 + (index >> 3);
      pdu[byteIndex] = (pdu[byteIndex] ?? 0) | (1 << (index % 8));
    }
  }
  return pdu;
}

export function encodeWriteMultipleRegisters(address: number, values: number[]): Uint8Array {
  const byteCount = values.length * 2;
  const pdu = new Uint8Array(6 + byteCount);
  pdu[0] = 0x10;
  pdu[1] = (address >> 8) & 0xff;
  pdu[2] = address & 0xff;
  pdu[3] = (values.length >> 8) & 0xff;
  pdu[4] = values.length & 0xff;
  pdu[5] = byteCount;
  for (const [index, value] of values.entries()) {
    pdu[6 + index * 2] = (value >> 8) & 0xff;
    pdu[7 + index * 2] = value & 0xff;
  }
  return pdu;
}

export type PduDecodeResult =
  | { kind: 'bits'; values: boolean[] }
  | { kind: 'registers'; values: number[] }
  | { kind: 'echo'; functionCode: 0x05 | 0x06 | 0x0f | 0x10; address: number; value: number }
  | { kind: 'exception'; functionCode: number; exceptionCode: number };

export function decodePdu(pdu: Uint8Array, requestFunctionCode: number): PduDecodeResult {
  if (pdu.length === 0) {
    throw new ModbusError('MODBUS_PROTOCOL_ERROR', 'Empty PDU.');
  }
  const functionCode = pdu[0]!;

  if (functionCode === requestFunctionCode + 0x80) {
    if (pdu.length < 2) {
      throw new ModbusError('MODBUS_PROTOCOL_ERROR', 'Truncated exception response.');
    }
    return { kind: 'exception', functionCode: requestFunctionCode, exceptionCode: pdu[1]! };
  }
  if (functionCode !== requestFunctionCode) {
    throw new ModbusError(
      'MODBUS_PROTOCOL_ERROR',
      `Response function 0x${functionCode.toString(16)} does not match request 0x${requestFunctionCode.toString(16)}.`,
    );
  }

  switch (functionCode) {
    case 0x01:
    case 0x02: {
      const byteCount = pdu[1]!;
      const values: boolean[] = [];
      for (let i = 0; i < byteCount * 8; i += 1) {
        values.push(Boolean(pdu[2 + (i >> 3)]! & (1 << (i % 8))));
      }
      return { kind: 'bits', values };
    }
    case 0x03:
    case 0x04: {
      const byteCount = pdu[1]!;
      if (byteCount % 2 !== 0) {
        throw new ModbusError('MODBUS_PROTOCOL_ERROR', 'Odd register byte count.');
      }
      const values: number[] = [];
      for (let i = 0; i < byteCount; i += 2) {
        values.push((pdu[2 + i]! << 8) | pdu[3 + i]!);
      }
      return { kind: 'registers', values };
    }
    case 0x05:
    case 0x06:
      return {
        kind: 'echo',
        functionCode,
        address: (pdu[1]! << 8) | pdu[2]!,
        value: (pdu[3]! << 8) | pdu[4]!,
      };
    case 0x0f:
    case 0x10:
      return {
        kind: 'echo',
        functionCode: functionCode as 0x0f | 0x10,
        address: (pdu[1]! << 8) | pdu[2]!,
        value: (pdu[3]! << 8) | pdu[4]!,
      };
    default:
      throw new ModbusError(
        'MODBUS_PROTOCOL_ERROR',
        `Unsupported function code 0x${functionCode.toString(16)}.`,
      );
  }
}

function assertQuantity(functionCode: number, quantity: number): void {
  const max = functionCode === 0x01 || functionCode === 0x02 ? 2000 : 125;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
    throw new ModbusError(
      'MODBUS_INVALID_QUANTITY',
      `Quantity must be an integer in [1, ${max}] for function 0x${functionCode.toString(16)}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// MBAP (TCP) framing
// ---------------------------------------------------------------------------

export interface MbapFrame {
  transactionId: number;
  protocolId: number;
  unitId: number;
  pdu: Uint8Array;
}

export function encodeMbap(transactionId: number, unitId: number, pdu: Uint8Array): Uint8Array {
  const frame = new Uint8Array(7 + pdu.length);
  frame[0] = (transactionId >> 8) & 0xff;
  frame[1] = transactionId & 0xff;
  frame[2] = 0x00;
  frame[3] = 0x00;
  frame[4] = ((pdu.length + 1) >> 8) & 0xff;
  frame[5] = (pdu.length + 1) & 0xff;
  frame[6] = unitId;
  frame.set(pdu, 7);
  return frame;
}

export function decodeMbap(frame: Uint8Array): MbapFrame {
  if (frame.length < 7) {
    throw new ModbusError('MODBUS_PROTOCOL_ERROR', 'MBAP frame shorter than 7 bytes.');
  }
  const length = (frame[4]! << 8) | frame[5]!;
  const expected = length + 6;
  if (frame.length < expected) {
    throw new ModbusError(
      'MODBUS_PROTOCOL_ERROR',
      `MBAP length field ${length} exceeds available bytes.`,
    );
  }
  return {
    transactionId: (frame[0]! << 8) | frame[1]!,
    protocolId: (frame[2]! << 8) | frame[3]!,
    unitId: frame[6]!,
    pdu: frame.slice(7, expected),
  };
}

/** Extract one complete MBAP frame from the head of `buffer`; returns how many bytes it consumed. */
export function tryDecodeMbap(
  buffer: Uint8Array,
): { frame: MbapFrame; consumed: number } | undefined {
  if (buffer.length < 7) return undefined;
  const length = (buffer[4]! << 8) | buffer[5]!;
  const total = length + 6;
  if (buffer.length < total) return undefined;
  return { frame: decodeMbap(buffer), consumed: total };
}

// ---------------------------------------------------------------------------
// RTU framing
// ---------------------------------------------------------------------------

export function encodeRtu(slaveAddress: number, pdu: Uint8Array): Uint8Array {
  // address (1) + pdu + crc16 low + crc16 high
  const frame = new Uint8Array(3 + pdu.length);
  frame[0] = slaveAddress;
  frame.set(pdu, 1);
  const crc = crc16(frame.subarray(0, 1 + pdu.length));
  frame[1 + pdu.length] = crc & 0xff;
  frame[2 + pdu.length] = (crc >> 8) & 0xff;
  return frame;
}

export function decodeRtu(
  frame: Uint8Array,
  requestFunctionCode: number,
  expectedAddress: number,
): PduDecodeResult {
  if (frame.length < 4) {
    throw new ModbusError('MODBUS_PROTOCOL_ERROR', 'RTU frame too short.');
  }
  const address = frame[0]!;
  if (address !== expectedAddress) {
    throw new ModbusError(
      'MODBUS_PROTOCOL_ERROR',
      `Response from slave ${address}, expected ${expectedAddress}.`,
    );
  }
  const pdu = frame.subarray(1, frame.length - 2);
  const receivedCrc = frame[frame.length - 2]! | (frame[frame.length - 1]! << 8);
  const computedCrc = crc16(frame.subarray(0, frame.length - 2));
  if (receivedCrc !== computedCrc) {
    throw new ModbusError(
      'MODBUS_CRC_ERROR',
      `CRC mismatch: received 0x${receivedCrc.toString(16)}, computed 0x${computedCrc.toString(16)}.`,
    );
  }
  return decodePdu(pdu, requestFunctionCode);
}
