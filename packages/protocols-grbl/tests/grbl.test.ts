import { describe, expect, it } from 'vitest';
import { GrblClient, parseStatusLine } from '../src/grblClient.js';
import { GrblError } from '../src/errors.js';
import { GrblSimulatorTransport } from '../src/grblSimulator.js';

describe('GRBL status parsing', () => {
  it('parses states and positions', () => {
    const status = parseStatusLine('<Idle|WPos:1.000,2.000,3.000|MPos:11.000,7.000,3.000|FS:0,0>');
    expect(status.state).toBe('Idle');
    expect(status.wpos).toEqual({ x: 1, y: 2, z: 3 });
    expect(status.mpos).toEqual({ x: 11, y: 7, z: 3 });
  });

  it('handles states without position fields', () => {
    const status = parseStatusLine('<Alarm>');
    expect(status.state).toBe('Alarm');
    expect(status.wpos).toBeUndefined();
  });
});

describe('GrblClient against the simulator', () => {
  it('serializes concurrent queries and consumes parser acknowledgements before moves', async () => {
    const transport = new GrblSimulatorTransport({ travel: { x: 20, y: 20, z: 20 } });
    const client = new GrblClient(transport);
    await client.start();
    try {
      await client.home();
      const [parser, status] = await Promise.all([client.parserState(), client.status()]);
      expect(parser).toContain('G21');
      expect(status.state).toBe('Idle');
      await expect(client.rapidMove({ x: 500 })).rejects.toBeInstanceOf(GrblError);
      await client.rapidMove({ x: 5 });
      expect((await client.status()).wpos?.x).toBe(5);
    } finally {
      await client.close();
    }
  });

  it('sends one newline and explicit units, distance mode, and feed mode per move', async () => {
    const transport = new GrblSimulatorTransport();
    const write = transport.write.bind(transport);
    const commands: string[] = [];
    transport.write = async (bytes) => {
      commands.push(new TextDecoder().decode(bytes));
      await write(bytes);
    };
    const client = new GrblClient(transport);
    await client.start();
    await client.feedMove({ x: 2 }, 30);
    expect(commands).toContain('G21 G90 G94 G1 X2 F30\n');
    await client.close();
  });
  it('handshakes, polls status, homes, and moves', async () => {
    const transport = new GrblSimulatorTransport({ travel: { x: 200, y: 200, z: 100 } });
    const client = new GrblClient(transport);
    await client.start();

    const idle = await client.status();
    expect(idle.state).toBe('Idle');
    expect(idle.wpos).toEqual({ x: 0, y: 0, z: 0 });

    await client.home();
    const afterHome = await client.status();
    expect(afterHome.state).toBe('Idle');

    await client.rapidMove({ x: 10, y: 5 });
    const afterMove = await client.status();
    expect(afterMove.wpos).toEqual({ x: 10, y: 5, z: 0 });

    await client.feedMove({ x: 12 }, 300);
    const afterFeed = await client.status();
    expect(afterFeed.wpos!.x).toBeCloseTo(12);

    const parserState = await client.parserState();
    expect(parserState).toContain('G21'); // millimeter mode in parser state

    await client.feedHold();
    const held = await client.status();
    expect(['Hold:0', 'Idle']).toContain(held.state);

    await client.close();
  });

  it('rejects moves outside soft limits with error:33 and typed errors', async () => {
    const transport = new GrblSimulatorTransport({ travel: { x: 200, y: 200, z: 100 } });
    const client = new GrblClient(transport);
    await client.start();
    await client.home();
    await expect(client.rapidMove({ x: 500 })).rejects.toMatchObject({
      code: 'GRBL_ERROR',
      grblErrorCode: 33,
    });
    await expect(client.rapidMove({ x: 500 })).rejects.toBeInstanceOf(GrblError);
    await client.close();
  });

  it('refuses to home before homing completes… (unhomed moves are rejected by the simulator)', async () => {
    const transport = new GrblSimulatorTransport({ travel: { x: 200, y: 200, z: 100 } });
    const client = new GrblClient(transport);
    await client.start();
    await expect(client.rapidMove({ x: 10 })).rejects.toMatchObject({ grblErrorCode: 9 });
    await client.close();
  });

  it('validates arguments before touching the wire', async () => {
    const transport = new GrblSimulatorTransport();
    const client = new GrblClient(transport);
    await client.start();
    await expect(client.feedMove({ x: 1 }, 0)).rejects.toMatchObject({ code: 'GRBL_INVALID_FEED' });
    await expect(client.feedMove({ x: 1 }, -5)).rejects.toMatchObject({
      code: 'GRBL_INVALID_FEED',
    });
    await expect(client.rapidMove({})).rejects.toMatchObject({ code: 'GRBL_INVALID_POSITION' });
    await expect(client.rapidMove({ x: Number.NaN })).rejects.toMatchObject({
      code: 'GRBL_INVALID_POSITION',
    });
    await client.close();
  });
});
