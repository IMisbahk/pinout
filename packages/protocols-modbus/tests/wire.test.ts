import { describe, expect, it } from 'vitest';
import {
  ModbusError,
  crc16,
  decodeMbap,
  decodePdu,
  decodeRtu,
  encodeMbap,
  encodeRtu,
  encodeWriteMultipleCoils,
  tryDecodeMbap,
} from '../src/wire.js';

describe('crc16', () => {
  it('computes the standard Modbus CRC', () => {
    // Reference vector: CRC of [0x01,0x03,0x00,0x00,0x00,0x0A] is 0xCDC5
    // (verified against an independent implementation of the standard
    // 0xA001/0xFFFF algorithm).
    expect(crc16(new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]))).toBe(0xcdc5);
    expect(crc16(new Uint8Array([]))).toBe(0xffff);
    // Single byte: CRC([0x01]) known vector.
    expect(crc16(new Uint8Array([0x01]))).toBe(0x807e);
  });
});

describe('MBAP framing', () => {
  it('round-trips transaction id, unit id, and PDU', () => {
    const pdu = new Uint8Array([0x03, 0x00, 0x00, 0x00, 0x02]);
    const frame = encodeMbap(0x1234, 5, pdu);
    const decoded = decodeMbap(frame);
    expect(decoded.transactionId).toBe(0x1234);
    expect(decoded.protocolId).toBe(0);
    expect(decoded.unitId).toBe(5);
    expect(Array.from(decoded.pdu)).toEqual(Array.from(pdu));
  });

  it('length field counts unit id + PDU', () => {
    const pdu = new Uint8Array([0x01, 0x02]);
    const frame = encodeMbap(1, 1, pdu);
    expect((frame[4]! << 8) | frame[5]!).toBe(3);
    expect(frame.length).toBe(9);
  });

  it('tryDecodeMbap reports partial frames and consumes exactly one', () => {
    const frame = encodeMbap(7, 1, new Uint8Array([0x03, 0x00, 0x00, 0x00, 0x01]));
    const partial = frame.slice(0, 5);
    expect(tryDecodeMbap(partial)).toBeUndefined();

    const twoFrames = new Uint8Array([...frame, ...frame]);
    const first = tryDecodeMbap(twoFrames)!;
    expect(first.consumed).toBe(frame.length);
    expect(first.frame.transactionId).toBe(7);
    expect(tryDecodeMbap(twoFrames.subarray(first.consumed))!.frame.transactionId).toBe(7);
  });
});

describe('PDU decode', () => {
  it('decodes read-coil responses into bit arrays', () => {
    // FC 0x01 response: byteCount=1, bits=0b101 (coils 0,2 on)
    const decoded = decodePdu(new Uint8Array([0x01, 0x01, 0x05]), 0x01);
    expect(decoded).toEqual({ kind: 'bits', values: [true, false, true, false, false, false, false, false] });
  });

  it('decodes read-holding-register responses', () => {
    // FC 0x03 response: byteCount=4, regs 0x0102, 0x0304
    const decoded = decodePdu(new Uint8Array([0x03, 0x04, 0x01, 0x02, 0x03, 0x04]), 0x03);
    expect(decoded).toEqual({ kind: 'registers', values: [0x0102, 0x0304] });
  });

  it('parses exception responses into a typed result', () => {
    const decoded = decodePdu(new Uint8Array([0x83, 0x02]), 0x03);
    expect(decoded).toEqual({ kind: 'exception', functionCode: 0x03, exceptionCode: 0x02 });
  });

  it('rejects a response whose function code does not match the request', () => {
    expect(() => decodePdu(new Uint8Array([0x04, 0x02, 0x00, 0x00]), 0x03)).toThrowError(/does not match request/);
    expect(() => decodePdu(new Uint8Array([]), 0x03)).toThrowError(/Empty PDU/);
  });
});

describe('RTU framing', () => {
  it('round-trips a proper response frame', () => {
    // Slave 17 answers FC 0x03 with two registers 0x0102, 0x0304.
    const responsePdu = new Uint8Array([0x03, 0x04, 0x01, 0x02, 0x03, 0x04]);
    const frame = encodeRtu(17, responsePdu);
    expect(frame.length).toBe(9);
    const decoded = decodeRtu(frame, 0x03, 17);
    expect(decoded).toEqual({ kind: 'registers', values: [0x0102, 0x0304] });
  });

  it('detects CRC corruption', () => {
    const pdu = new Uint8Array([0x03, 0x02, 0x12, 0x34]);
    const frame = encodeRtu(1, pdu);
    frame[2] = frame[2]! ^ 0xff; // corrupt a data byte
    expect(() => decodeRtu(frame, 0x03, 1)).toThrowError(ModbusError);
    try {
      decodeRtu(frame, 0x03, 1);
    } catch (error) {
      expect((error as ModbusError).code).toBe('MODBUS_CRC_ERROR');
    }
  });

  it('rejects responses from the wrong slave', () => {
    const pdu = new Uint8Array([0x03, 0x02, 0x12, 0x34]);
    const frame = encodeRtu(2, pdu);
    expect(() => decodeRtu(frame, 0x03, 1)).toThrowError(/from slave 2, expected 1/);
  });

  it('write-multiple-coils packs bits LSB-first', () => {
    const pdu = encodeWriteMultipleCoils(10, [true, false, true, true]);
    expect(pdu[0]).toBe(0x0f);
    expect(pdu[5]).toBe(1); // byte count
    expect(pdu[6]).toBe(0b1101); // bits 0..3: 1,0,1,1
  });
});
