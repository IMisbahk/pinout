export class ByteQueue implements AsyncIterable<Uint8Array> {
  private readonly chunks: Uint8Array[] = [];
  private readonly waiters: Array<(chunk: Uint8Array | null) => void> = [];
  private closed = false;
  private failure: Error | undefined;

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

  fail(error: Error): void {
    if (this.closed) {
      return;
    }
    this.failure = error;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter(null);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    while (true) {
      if (this.failure) {
        throw this.failure;
      }
      const chunk = this.chunks.shift();
      if (chunk) {
        yield chunk;
        continue;
      }
      if (this.closed) {
        if (this.failure) {
          throw this.failure;
        }
        return;
      }
      const next = await new Promise<Uint8Array | null>((resolve) => {
        this.waiters.push(resolve);
      });
      if (this.failure) {
        throw this.failure;
      }
      if (next === null) {
        return;
      }
      yield next;
    }
  }
}
