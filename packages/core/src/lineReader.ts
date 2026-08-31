export async function* readLines(
  readable: AsyncIterable<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of readable) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineAt = buffer.indexOf('\n');
    while (newlineAt >= 0) {
      const line = buffer.slice(0, newlineAt).replace(/\r$/, '');
      buffer = buffer.slice(newlineAt + 1);
      if (line.length > 0) {
        yield line;
      }
      newlineAt = buffer.indexOf('\n');
    }
  }

  buffer += decoder.decode();
  const leftover = buffer.replace(/\r$/, '').trim();
  if (leftover.length > 0) {
    yield leftover;
  }
}

export function encodeLine(text: string): Uint8Array {
  return new TextEncoder().encode(text.endsWith('\n') ? text : `${text}\n`);
}
