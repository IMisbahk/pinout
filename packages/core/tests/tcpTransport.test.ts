import { describe, expect, it } from 'vitest';
import { connect, encodeEvent, encodeResponse, parseLine, tcpTransport } from '@pinout/core';
import { createServer, type AddressInfo } from 'node:net';
import { simulatedEsp32 } from '@pinout/core';

describe('tcpTransport', () => {
  it('can handshake with a TCP simulator bridge', async () => {
    const inner = simulatedEsp32();
    const server = createServer(async (socket) => {
      await inner.open();
      const pump = (async () => {
        for await (const chunk of inner.readable) {
          socket.write(Buffer.from(chunk));
        }
      })();
      socket.on('data', (chunk) => {
        void inner.write(new Uint8Array(chunk));
      });
      socket.on('close', () => {
        void inner.close();
        void pump.catch(() => undefined);
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as AddressInfo;
    const device = await connect({
      transport: tcpTransport({ host: '127.0.0.1', port: address.port }),
      timeoutMs: 2000,
    });
    try {
      await device.gpio.write(2, true);
      await expect(device.gpio.read(2)).resolves.toBe(true);
    } finally {
      await device.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});

describe('protocol leftover helpers', () => {
  it('parseLine still accepts encoded events from the tcp path', () => {
    const line = encodeEvent('ready', {
      firmware: 'esp32-bridge',
      version: '0.1.0',
      protocol: 1,
      capabilities: ['sys.hello'],
    });
    expect(parseLine(line)).toMatchObject({ event: 'ready' });
    expect(parseLine(encodeResponse('id', {}))).toMatchObject({ ok: true, id: 'id' });
  });
});
