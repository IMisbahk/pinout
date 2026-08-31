import { describe, expect, it } from 'vitest';
import { encodeEvent, encodeResponse, parseLine } from '../src/protocol.js';
import { loopbackTransport } from '../src/transports/loopbackTransport.js';
import { connect } from '../src/connect.js';

describe('loopbackTransport', () => {
  it('responds to writes with scripted lines', async () => {
    const transport = loopbackTransport({
      onOpen: () => [encodeEvent('ready', { firmware: 'test', version: '0', protocol: 1, capabilities: ['sys.hello'] })],
      onWrite: (data) => {
        const line = data.trim();
        const message = parseLine(line);
        if (message && 'action' in message && message.action === 'sys.hello') {
          return encodeResponse(message.id, {
            firmware: 'test',
            version: '0',
            protocol: 1,
            capabilities: ['sys.hello'],
          });
        }
        return undefined;
      },
    });

    const device = await connect({ transport, timeoutMs: 2000 });
    try {
      expect(device.info.firmware).toBe('test');
    } finally {
      await device.close();
    }
  });

  it('supports manual inject', async () => {
    const transport = loopbackTransport();
    transport.inject(encodeEvent('ready', { firmware: 'x', version: '0', protocol: 1, capabilities: [] }));
    await transport.open();
    await transport.close();
  });
});
