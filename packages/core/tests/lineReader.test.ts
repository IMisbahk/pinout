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

  it('drops an oversized frame and resumes at the next newline', async () => {
    async function* chunks(): AsyncIterable<Uint8Array> {
      yield new TextEncoder().encode('x'.repeat(20));
      yield new TextEncoder().encode('x\nnext\n');
    }

    const lines: string[] = [];
    for await (const line of readLines(chunks(), 16)) lines.push(line);
    expect(lines).toEqual(['next']);
  });
});
