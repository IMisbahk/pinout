import { describe, expect, it } from 'vitest';
import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { TransportError } from '../src/errors.js';
import { udpTransport } from '../src/transports/udpTransport.js';

const LOOPBACK = '127.0.0.1';

function bindEphemeral(socket: dgram.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind({ port: 0, address: LOOPBACK }, () => resolve());
  });
}

function nextChunk(
  iterator: AsyncIterator<Uint8Array>,
  timeoutMs = 2000,
): Promise<IteratorResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for a datagram.'));
    }, timeoutMs);
    timer.unref();
    iterator.next().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

describe('udpTransport', () => {
  it('exchanges datagrams between two loopback transports on ephemeral ports', async () => {
    // A plain relay socket lets both transports bind ephemeral ports while
    // still knowing where to send: datagrams are forwarded to the other side.
    const relay = dgram.createSocket('udp4');
    await bindEphemeral(relay);
    const relayPort = (relay.address() as AddressInfo).port;
    // ICMP port-unreachable errors must not crash the test process.
    relay.on('error', () => undefined);

    const a = udpTransport({ host: LOOPBACK, remotePort: relayPort, remoteHost: LOOPBACK });
    const b = udpTransport({ host: LOOPBACK, remotePort: relayPort, remoteHost: LOOPBACK });
    relay.on('message', (message, rinfo) => {
      const target = rinfo.port === a.localPort ? b : a;
      const targetPort = target.localPort;
      if (!targetPort) {
        return;
      }
      relay.send(message, targetPort, LOOPBACK);
    });
    await a.open();
    await b.open();

    try {
      expect(a.localPort).not.toBe(b.localPort);

      const aIterator = a.readable[Symbol.asyncIterator]();
      const bIterator = b.readable[Symbol.asyncIterator]();

      await a.write(new TextEncoder().encode('ping-from-a'));
      const atB = await nextChunk(bIterator);
      expect(new TextDecoder().decode(atB.value)).toBe('ping-from-a');

      await b.write(new TextEncoder().encode('pong-from-b'));
      const atA = await nextChunk(aIterator);
      expect(new TextDecoder().decode(atA.value)).toBe('pong-from-b');
    } finally {
      await a.close();
      await b.close();
      relay.close();
    }
  });

  it('write before open throws a TransportError', async () => {
    const transport = udpTransport({
      remotePort: 9,
      remoteHost: LOOPBACK,
    });
    await expect(transport.write(new TextEncoder().encode('nope'))).rejects.toBeInstanceOf(
      TransportError,
    );
  });

  it('close releases the bound port', async () => {
    const transport = udpTransport({
      host: LOOPBACK,
      remotePort: 9,
      remoteHost: LOOPBACK,
    });
    await transport.open();
    const boundPort = transport.localPort;
    expect(boundPort).toBeGreaterThan(0);
    await transport.close();
    await transport.close(); // idempotent

    const probe = dgram.createSocket('udp4');
    try {
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.bind({ port: boundPort, address: LOOPBACK }, () => resolve());
      });
      expect((probe.address() as AddressInfo).port).toBe(boundPort);
    } finally {
      probe.close();
    }
  });

  it('closes itself after the idle window expires', async () => {
    const transport = udpTransport({
      host: LOOPBACK,
      remotePort: 9,
      remoteHost: LOOPBACK,
      closeIfIdleFor: 60,
    });
    await transport.open();
    const iterator = transport.readable[Symbol.asyncIterator]();

    const end = await nextChunk(iterator, 2000).then(
      (result) => result,
      () => 'errored',
    );
    expect(end).toEqual({ done: true, value: undefined });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 120);
      timer.unref();
    });
    await expect(transport.write(new TextEncoder().encode('late'))).rejects.toBeInstanceOf(
      TransportError,
    );
  });

  it('keeps the connection alive while traffic flows', async () => {
    const sink = dgram.createSocket('udp4');
    await bindEphemeral(sink);
    const sinkPort = (sink.address() as AddressInfo).port;
    let received = 0;
    sink.on('message', () => {
      received += 1;
    });

    const transport = udpTransport({
      host: LOOPBACK,
      remotePort: sinkPort,
      remoteHost: LOOPBACK,
      closeIfIdleFor: 120,
    });
    await transport.open();

    for (let i = 0; i < 5; i++) {
      await transport.write(new TextEncoder().encode(`tick-${i}`));
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 50);
        timer.unref();
      });
    }

    expect(received).toBe(5);
    await transport.close();
    sink.close();
  });
});
