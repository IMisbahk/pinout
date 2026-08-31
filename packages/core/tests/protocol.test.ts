import { describe, expect, it } from 'vitest';
import { encodeRequest, parseLine, protocolVersion } from '@pinout/core';
import { ProtocolError } from '@pinout/core';

describe('protocol', () => {
  it('encodes a versioned request as a JSON line', () => {
    const line = encodeRequest('abc', 'gpio.write', { pin: 2, value: true });
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      v: protocolVersion,
      id: 'abc',
      action: 'gpio.write',
      payload: { pin: 2, value: true },
    });
  });

  it('ignores non-JSON boot log lines', () => {
    expect(parseLine('ets Jun  8 2016 00:22:57')).toBeNull();
    expect(parseLine('rst:0x1 (POWERON_RESET)')).toBeNull();
  });

  it('parses a successful response', () => {
    const message = parseLine('{"v":1,"id":"abc","ok":true,"result":{"pin":2,"value":true}}');
    expect(message).toEqual({
      v: 1,
      id: 'abc',
      ok: true,
      result: { pin: 2, value: true },
    });
  });

  it('parses an error response', () => {
    const message = parseLine(
      '{"v":1,"id":"abc","ok":false,"error":{"code":"INVALID_PIN","message":"nope"}}',
    );
    expect(message).toEqual({
      v: 1,
      id: 'abc',
      ok: false,
      error: { code: 'INVALID_PIN', message: 'nope' },
    });
  });

  it('parses a ready event', () => {
    const message = parseLine(
      '{"v":1,"event":"ready","payload":{"firmware":"esp32-bridge","version":"0.1.0","protocol":1,"capabilities":["gpio.write"]}}',
    );
    expect(message).toMatchObject({ event: 'ready' });
  });

  it('strips carriage returns', () => {
    const message = parseLine('{"v":1,"id":"1","ok":true,"result":{}}\r');
    expect(message).toMatchObject({ id: '1', ok: true });
  });

  it('rejects invalid JSON that looks like a protocol line', () => {
    expect(() => parseLine('{not-json')).toThrow(ProtocolError);
  });

  it('rejects an unsupported protocol version', () => {
    expect(() => parseLine('{"v":99,"id":"1","ok":true,"result":{}}')).toThrow(ProtocolError);
  });
});
