/**
 * High-rate data plane (spec v1).
 *
 * Camera frames, LiDAR points, IMU telemetry and similar payloads must not
 * ride the control plane: the StreamBus is an in-runtime broker that fans out
 * frames to consumers with bounded queues and explicit backpressure policies.
 *
 * Control (discover streams, start/stop, read metadata, take a snapshot)
 * stays on the control plane; bulk frames flow through here.
 */

export interface StreamDescriptor {
  /** Stream id, namespaced per device, e.g. `wrist-camera:rgb`. */
  id: string;
  deviceId: string;
  name: string;
  codec?: string;
  nominalRateHz?: number;
  /** Frame payload description, e.g. `uint8[width*height*3]`. */
  layout?: string;
  metadata?: Record<string, unknown>;
}

export interface StreamFrame {
  streamId: string;
  /** Monotonic per-stream sequence starting at 0. */
  sequence: number;
  /** Epoch ms when the frame was captured, if the source provides it. */
  sourceAt?: number;
  at: number;
  data: Uint8Array | Record<string, unknown> | number;
  metadata?: Record<string, unknown>;
}

export type BackpressurePolicy = 'drop-oldest' | 'drop-latest' | 'latest-only';

export interface SubscribeOptions {
  bufferSize?: number;
  policy?: BackpressurePolicy;
}

export interface StreamHandle {
  readonly streamId: string;
  close(): void;
  /** AsyncIterable of frames; ends when the stream closes or handle closes. */
  [Symbol.asyncIterator](): AsyncIterator<StreamFrame>;
  /** Collect up to `n` frames (resolves early when the stream ends). */
  sample(n: number): Promise<StreamFrame[]>;
  readonly ended: Promise<void>;
}

export interface StreamStats {
  publishedFrames: number;
  droppedFrames: number;
  subscribers: number;
}

const DEFAULT_BUFFER = 64;

export class StreamBus {
  private readonly streams = new Map<string, StreamDescriptor>();
  private readonly subscribers = new Map<string, Set<SubscriberQueue>>();
  private readonly latestFrame = new Map<string, StreamFrame>();
  private readonly sequences = new Map<string, number>();
  private readonly endSignals = new Map<string, Array<() => void>>();
  private statsMap = new Map<string, { published: number; dropped: number }>();

  /** Register a stream. Publishing to an unregistered stream throws. */
  register(descriptor: StreamDescriptor): StreamDescriptor {
    if (this.streams.has(descriptor.id)) {
      throw new Error(`Stream '${descriptor.id}' is already registered.`);
    }
    this.streams.set(descriptor.id, { ...descriptor });
    this.statsMap.set(descriptor.id, { published: 0, dropped: 0 });
    return { ...descriptor };
  }

  list(deviceId?: string): StreamDescriptor[] {
    const out: StreamDescriptor[] = [];
    for (const stream of this.streams.values()) {
      if (deviceId && stream.deviceId !== deviceId) continue;
      out.push({ ...stream });
    }
    return out;
  }

  get(streamId: string): StreamDescriptor | undefined {
    const stream = this.streams.get(streamId);
    return stream ? { ...stream } : undefined;
  }

  /** Publish a frame; assigns the sequence number and fans out. */
  publish(
    streamId: string,
    data: StreamFrame['data'],
    options: { sourceAt?: number; metadata?: Record<string, unknown> } = {},
  ): StreamFrame | undefined {
    if (!this.streams.has(streamId)) {
      throw new Error(`Cannot publish to unknown stream '${streamId}'.`);
    }
    const sequence = this.sequences.get(streamId) ?? 0;
    this.sequences.set(streamId, sequence + 1);
    const frame: StreamFrame = {
      streamId,
      sequence,
      ...(options.sourceAt !== undefined ? { sourceAt: options.sourceAt } : {}),
      at: Date.now(),
      data,
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    };
    this.latestFrame.set(streamId, frame);
    const stats = this.statsMap.get(streamId)!;
    stats.published += 1;

    const subs = this.subscribers.get(streamId);
    if (subs) {
      for (const sub of subs) {
        if (sub.policy === 'latest-only') {
          sub.queue.length = 0;
          sub.queue.push(frame);
        } else if (sub.queue.length >= sub.bufferSize) {
          if (sub.policy === 'drop-oldest') {
            sub.queue.shift();
            sub.queue.push(frame);
          } else {
            // drop-latest: the incoming frame is discarded.
          }
          stats.dropped += 1;
        } else {
          sub.queue.push(frame);
        }
        sub.notify();
      }
    }
    return frame;
  }

  /** Most recent frame without subscribing — snapshot semantics. */
  snapshot(streamId: string): StreamFrame | undefined {
    const frame = this.latestFrame.get(streamId);
    return frame ? { ...frame } : undefined;
  }

  subscribe(streamId: string, options: SubscribeOptions = {}): StreamHandle {
    if (!this.streams.has(streamId)) {
      throw new Error(`Unknown stream '${streamId}'.`);
    }
    const sub: SubscriberQueue = {
      queue: [],
      bufferSize: options.bufferSize ?? DEFAULT_BUFFER,
      policy: options.policy ?? 'drop-oldest',
      notify: () => undefined,
      closed: false,
    };
    let subs = this.subscribers.get(streamId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(streamId, subs);
    }
    subs.add(sub);

    let endedResolve!: () => void;
    const ended = new Promise<void>((resolve) => {
      endedResolve = resolve;
    });
    const endSignals = this.endSignals.get(streamId) ?? [];
    endSignals.push(endedResolve);
    this.endSignals.set(streamId, endSignals);

    let iteratorDone = false;
    const finish = (): void => {
      if (iteratorDone) return;
      iteratorDone = true;
      endedResolve();
      subs!.delete(sub);
      const index = endSignals.indexOf(endedResolve);
      if (index !== -1) endSignals.splice(index, 1);
    };

    const next = (): Promise<IteratorResult<StreamFrame>> => {
      if (iteratorDone) return Promise.resolve({ done: true, value: undefined as never });
      if (sub.queue.length > 0) {
        return Promise.resolve({ done: false, value: sub.queue.shift()! });
      }
      if (sub.closed) {
        finish();
        return Promise.resolve({ done: true, value: undefined as never });
      }
      return new Promise<IteratorResult<StreamFrame>>((resolve) => {
        sub.notify = () => {
          sub.notify = () => undefined;
          if (iteratorDone) return resolve({ done: true, value: undefined as never });
          if (sub.queue.length > 0) resolve({ done: false, value: sub.queue.shift()! });
          else if (sub.closed) {
            finish();
            resolve({ done: true, value: undefined as never });
          }
        };
      });
    };

    return {
      streamId,
      close: () => {
        sub.closed = true;
        sub.notify();
        finish();
      },
      ended,
      sample: async (n: number): Promise<StreamFrame[]> => {
        const out: StreamFrame[] = [];
        for (let i = 0; i < n; i += 1) {
          const result = await next();
          if (result.done) break;
          out.push(result.value);
        }
        return out;
      },
      [Symbol.asyncIterator]() {
        return {
          next,
          return: () => {
            sub.closed = true;
            sub.notify();
            finish();
            return Promise.resolve({ done: true, value: undefined as never });
          },
        };
      },
    };
  }

  /** Close a stream: all subscriber iterators end. */
  closeStream(streamId: string): void {
    const signals = this.endSignals.get(streamId) ?? [];
    for (const resolve of signals) resolve();
    this.endSignals.delete(streamId);
    const subs = this.subscribers.get(streamId);
    if (subs) {
      for (const sub of subs) {
        sub.closed = true;
        sub.notify();
      }
      subs.clear();
    }
  }

  stats(streamId: string): StreamStats | undefined {
    const record = this.statsMap.get(streamId);
    if (!record) return undefined;
    return {
      publishedFrames: record.published,
      droppedFrames: record.dropped,
      subscribers: this.subscribers.get(streamId)?.size ?? 0,
    };
  }
}

interface SubscriberQueue {
  queue: StreamFrame[];
  bufferSize: number;
  policy: BackpressurePolicy;
  notify: () => void;
  closed: boolean;
}
