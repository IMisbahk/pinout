export async function* readLines(
  readable: AsyncIterable<Uint8Array>,
  maxLineBytes = 1024,
): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder();
  let buffer = '';
  let discardingOversizeLine = false;

  for await (const chunk of readable) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineAt = buffer.indexOf('\n');
    while (newlineAt >= 0) {
      const line = buffer.slice(0, newlineAt).replace(/\r$/, '');
      buffer = buffer.slice(newlineAt + 1);
      if (!discardingOversizeLine && line.length <= maxLineBytes && line.length > 0) {
        yield line;
      }
      discardingOversizeLine = false;
      newlineAt = buffer.indexOf('\n');
    }
    if (buffer.length > maxLineBytes) {
      // Retain only the post-newline tail on the next chunk. The oversized
      // frame is untrusted input and must never grow memory without bound.
      buffer = '';
      discardingOversizeLine = true;
    }
  }

  buffer += decoder.decode();
  const leftover = buffer.replace(/\r$/, '').trim();
  if (!discardingOversizeLine && leftover.length > 0 && leftover.length <= maxLineBytes) {
    yield leftover;
  }
}

export function encodeLine(text: string): Uint8Array {
  return new TextEncoder().encode(text.endsWith('\n') ? text : `${text}\n`);
}
