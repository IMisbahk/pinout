export class ByteQueue implements AsyncIterable<Uint8Array> {
  private readonly chunks: Uint8Array[] = [];
  private readonly waiters: Array<(chunk: Uint8Array | null) => void> = [];
  private closed = false;

  push(chunk: Uint8Array): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
      return;
    }
    this.chunks.push(chunk);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter(null);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    while (true) {
      const chunk = this.chunks.shift();
      if (chunk) {
        yield chunk;
        continue;
      }
      if (this.closed) {
        return;
      }
      const next = await new Promise<Uint8Array | null>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next === null) {
        return;
      }
      yield next;
    }
  }
}
