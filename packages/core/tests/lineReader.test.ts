import { describe, expect, it } from 'vitest';
import { readLines } from '../src/lineReader.js';

describe('readLines', () => {
  it('yields a leftover unterminated line when the stream ends', async () => {
    async function* chunks(): AsyncIterable<Uint8Array> {
      yield new TextEncoder().encode('{"v":1}\npartial');
    }

    const lines: string[] = [];
    for await (const line of readLines(chunks())) {
      lines.push(line);
    }
    expect(lines).toEqual(['{"v":1}', 'partial']);
  });
});
