import { describe, expect, it } from 'vitest';
import { decodeLine, parseLine, ProtocolError, simulatedEsp32 } from '@pinout/core';
import { encodeLine as encodeRawLine } from '../src/lineReader.js';

describe('decodeLine', () => {
  it('classifies boot logs as ignore', () => {
    expect(decodeLine('ets Jun  8 2016 00:22:57')).toEqual({ kind: 'ignore' });
  });

  it('classifies broken JSON as invalidJson', () => {
    expect(decodeLine('{not-json').kind).toBe('invalidJson');
  });

  it('classifies wrong version and missing id as invalidMessage', () => {
    expect(decodeLine('{"v":99,"id":"1","ok":true,"result":{}}').kind).toBe('invalidMessage');
    expect(decodeLine('{"v":1,"ok":true,"result":{}}').kind).toBe('invalidMessage');
  });

  it('still throws ProtocolError from parseLine for host-side use', () => {
    expect(() => parseLine('{not-json')).toThrow(ProtocolError);
    expect(() => parseLine('{"v":1,"foo":true}')).toThrow(ProtocolError);
  });
});

describe('simulated ESP32 parse errors', () => {
  it('maps invalid JSON and invalid messages like firmware', async () => {
    const transport = simulatedEsp32();
    await transport.open();
    const lines: string[] = [];
    const pump = (async () => {
      for await (const chunk of transport.readable) {
        lines.push(new TextDecoder().decode(chunk));
      }
    })();

    await transport.write(encodeRawLine('{not-json'));
    await transport.write(encodeRawLine('{"v":99,"id":"1","action":"sys.hello","payload":{}}'));
    await delay(20);
    await transport.close();
    await pump;

    const parsed = lines.map((line) => JSON.parse(line));
    expect(parsed.some((message) => message.event === 'ready')).toBe(true);
    expect(parsed.some((message) => message.error?.code === 'INVALID_JSON')).toBe(true);
    expect(parsed.some((message) => message.error?.code === 'INVALID_MESSAGE')).toBe(true);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
