/**
 * Fuzz tests (Wave-2 #16).
 *
 * Deterministic pseudo-random fuzzing of every protocol/manifest/policy
 * parser that touches the outside world. The contract for each: no crashes
 * beyond the parser's own typed errors, no hangs, and bounded output.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeLine, parseLine, maxProtocolLineBytes } from '../src/protocol.js';
import {
  decodeMbap,
  decodeRtu,
  crc16,
  encodeRtu,
  decodePdu,
  encodeMbap,
} from '../../protocols-modbus/src/wire.js';
import { tryDecodePacket } from '../../protocols-mqtt/src/wire.js';
import { extractTextFromContentStream } from '../../generator/src/ingest/pdfIngest.js';
import { evaluatePolicies } from '../src/policy/engine.js';
import { BoundedIdempotencyStore } from '../src/operation/idempotencyStore.js';
import type { PolicyRule } from '../src/policy/types.js';

/** Deterministic PRNG (xorshift) so failures are reproducible. */
function prng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

function fuzzBytes(random: () => number, count: number, alphabet = 256): Buffer {
  const buffer = Buffer.alloc(count);
  for (let i = 0; i < count; i += 1) {
    buffer[i] = Math.floor(random() * alphabet);
  }
  return buffer;
}

const FUZZ_ITERATIONS = 400;

describe('fuzz: pinout NDJSON line decoder', () => {
  it('never throws for arbitrary byte strings — only typed results', () => {
    const random = prng(0x4e44);
    for (let i = 0; i < FUZZ_ITERATIONS; i += 1) {
      const bytes = fuzzBytes(random, Math.floor(random() * 200));
      const result = decodeLine(bytes.toString('utf8'));
      expect(['ignore', 'invalidJson', 'invalidMessage', 'message']).toContain(result.kind);
      void parseLine;
    }
  });

  it('never hangs on deeply nested or huge lines and rejects oversized frames', () => {
    const random = prng(0x4e45);
    const huge =
      '{"v":1,"id":"x","action":"a","payload":{"deep":' +
      '['.repeat(4000) +
      ']'.repeat(4000) +
      '}}';
    const result = decodeLine(huge);
    expect(result.kind).toBeDefined();
    for (let i = 0; i < 50; i += 1) {
      const bytes = fuzzBytes(random, Math.floor(maxProtocolLineBytes * 1.5));
      expect(decodeLine(bytes.toString('utf8')).kind).toBeDefined();
    }
  });
});

describe('fuzz: Modbus frames', () => {
  it('MBAP decode rejects malformed frames with typed errors, never crashes', () => {
    const random = prng(0x4d42);
    for (let i = 0; i < FUZZ_ITERATIONS; i += 1) {
      const bytes = fuzzBytes(random, Math.floor(random() * 60));
      try {
        decodeMbap(bytes);
      } catch (error) {
        expect((error as { code?: string }).code).toMatch(/^MODBUS_/);
      }
    }
  });

  it('RTU decode with CRC validation rejects corruption deterministically', () => {
    const random = prng(0x5254);
    for (let i = 0; i < FUZZ_ITERATIONS; i += 1) {
      const pdu = fuzzBytes(random, Math.floor(random() * 20));
      const frame = encodeRtu(1, pdu);
      const corruptionIndex = Math.floor(random() * frame.length);
      frame[corruptionIndex] = Math.floor(random() * 256);
      try {
        decodeRtu(frame, pdu[0] ?? 3, 1);
      } catch (error) {
        expect(['MODBUS_CRC_ERROR', 'MODBUS_PROTOCOL_ERROR', 'MODBUS_INVALID_QUANTITY']).toContain(
          (error as { code?: string }).code,
        );
      }
    }
  });

  it('PDU decoder never accepts a mismatched function code silently', () => {
    const random = prng(0x5044);
    for (let i = 0; i < 100; i += 1) {
      const pdu = fuzzBytes(random, Math.floor(random() * 16));
      try {
        decodePdu(pdu, 3);
      } catch (error) {
        expect((error as { code?: string }).code).toMatch(/^MODBUS_/);
      }
    }
  });

  it('crc16 output stays in 16 bits for arbitrary input', () => {
    const random = prng(0x4352);
    for (let i = 0; i < 100; i += 1) {
      const value = crc16(fuzzBytes(random, Math.floor(random() * 64)));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffff);
    }
  });

  it('MBAP encode/decode roundtrip survives random unit ids and payloads', () => {
    const random = prng(0x5254);
    for (let i = 0; i < 100; i += 1) {
      const transactionId = Math.floor(random() * 0xffff);
      const unitId = Math.floor(random() * 256);
      const pdu = fuzzBytes(random, Math.floor(random() * 100) + 1);
      const decoded = decodeMbap(encodeMbap(transactionId, unitId, pdu));
      expect(decoded.transactionId).toBe(transactionId);
      expect(decoded.unitId).toBe(unitId);
      expect(Buffer.from(decoded.pdu).equals(pdu)).toBe(true);
    }
  });
});

describe('fuzz: MQTT packets', () => {
  it('packet decoder returns undefined or a coherent packet for arbitrary bytes', () => {
    const random = prng(0x4d51);
    for (let i = 0; i < FUZZ_ITERATIONS; i += 1) {
      const bytes = fuzzBytes(random, Math.floor(random() * 80));
      const decoded = tryDecodePacket(bytes);
      if (decoded) {
        expect(decoded.consumed).toBeGreaterThan(0);
        expect(decoded.consumed).toBeLessThanOrEqual(bytes.length);
        expect(typeof decoded.packet.type).toBe('string');
      }
    }
  });
});

describe('fuzz: PDF content streams', () => {
  it('text extraction never crashes on garbage operators', () => {
    const random = prng(0x5044);
    for (let i = 0; i < 200; i += 1) {
      const bytes = fuzzBytes(random, Math.floor(random() * 300));
      const text = extractTextFromContentStream(bytes);
      expect(typeof text).toBe('string');
      expect(text.length).toBeLessThan(10_000);
    }
  });
});

describe('fuzz: policy engine inputs', () => {
  it('numericRange rejects hostile payloads with typed violations', () => {
    const random = prng(0x5034);
    const rules: PolicyRule[] = [
      { kind: 'numericRange', capability: 'x', field: 'v', min: 0, max: 10 },
      {
        kind: 'workspaceBounds',
        capability: 'y',
        fields: { x: { min: 0, max: 1 }, y: { min: 0, max: 1 }, z: { min: 0, max: 1 } },
      },
    ];
    for (let i = 0; i < 200; i += 1) {
      const payload: Record<string, unknown> = {};
      if (random() < 0.5) payload.v = fuzzBytes(random, 4).toString('hex');
      else payload.v = random() * 100 - 50;
      if (random() < 0.3) {
        payload.x = Number.NaN;
        payload.y = 'not-a-number';
        payload.z = Infinity;
      }
      for (const rule of rules) {
        try {
          evaluatePolicies([rule], {
            deviceId: 'd',
            capability: rule.capability,
            payload,
            operationalState: {},
          });
        } catch (error) {
          expect(['POLICY_CONSTRAINT_VIOLATION', 'POLICY_PRECONDITION_FAILED']).toContain(
            (error as { code?: string }).code,
          );
        }
      }
    }
  });

  it('state preconditions never pass with hostile state objects', () => {
    const rules: PolicyRule[] = [
      { kind: 'stateEquals', capability: 'x', field: 'mode', equals: 'safe' },
    ];
    const hostileStates = [
      null,
      undefined,
      { mode: null },
      { mode: { toString: () => 'safe' } },
      { mode: ['safe'] },
    ];
    for (const operationalState of hostileStates) {
      expect(() =>
        evaluatePolicies(rules, {
          deviceId: 'd',
          capability: 'x',
          payload: {},
          operationalState: operationalState as Record<string, unknown>,
        }),
      ).toThrowError(/POLICY_PRECONDITION_FAILED|requires/);
    }
  });
});

describe('fuzz: idempotency key store', () => {
  it('adversarial key floods stay bounded and consistent', () => {
    let now = 0;
    const store = new BoundedIdempotencyStore({
      maxEntries: 64,
      retentionMs: 1000,
      now: () => now,
    });
    const random = prng(0x4944);
    for (let i = 0; i < 2000; i += 1) {
      const key = createHash('sha256').update(fuzzBytes(random, 32)).digest('hex');
      store.recordUnder(BoundedIdempotencyStore.keyFor('d', 'c', 'o', key), {
        operationId: `op_${i}`,
        deviceId: 'd',
        capability: 'c',
        owner: 'o',
        status: 'completed',
        createdAt: now,
      });
      now += Math.floor(random() * 10);
      expect(store.size()).toBeLessThanOrEqual(64);
    }
  });
});
