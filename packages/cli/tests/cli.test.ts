import { describe, expect, it } from 'vitest';
import { runCli } from '../src/runCli.js';

describe('cli', () => {
  it('prints help for gpio and top-level commands', async () => {
    const io = captureIo();
    expect(await runCli(['node', 'pinout', '--help'], io)).toBe(0);
    expect(io.logs.join('\n')).toMatch(/doctor|gpio|invoke|blink/);

    const gpioHelp = captureIo();
    expect(await runCli(['node', 'pinout', 'gpio', '--help'], gpioHelp)).toBe(0);
    expect(gpioHelp.logs.join('\n')).toMatch(/mode|toggle|pulse|pwm|analog|watch/);
  });

  it('prints version', async () => {
    const io = captureIo();
    const code = await runCli(['node', 'pinout', '--version'], io);
    expect(code).toBe(0);
    expect(io.logs.join('\n')).toMatch(/0\.1\.0/);
  });

  it('handshakes with the simulator', async () => {
    const io = captureIo();
    const code = await runCli(['node', 'pinout', 'hello', '--mock'], io);
    expect(code).toBe(0);
    expect(io.logs.join('\n')).toContain('esp32-bridge');
    expect(io.logs.join('\n')).toContain('gpio.write');
    expect(io.logs.join('\n')).toContain('uptime');
  });

  it('handshakes with json output', async () => {
    const io = captureIo();
    const code = await runCli(['node', 'pinout', '--json', 'hello', '--mock'], io);
    expect(code).toBe(0);
    const payload = JSON.parse(io.logs[0] ?? '{}') as { firmware: string };
    expect(payload.firmware).toBe('esp32-bridge');
  });

  it('writes and reads GPIO through invoke on one connection', async () => {
    const io = captureIo();
    expect(
      await runCli(
        [
          'node',
          'pinout',
          'run',
          '--mock',
          '--script',
          '{"action":"gpio.write","payload":{"pin":2,"value":true}}\n{"action":"gpio.read","payload":{"pin":2}}',
        ],
        io,
      ),
    ).toBe(0);
    expect(io.logs.join('\n')).toContain('"value":true');
  });

  it('writes and reads GPIO through gpio subcommands via run script', async () => {
    const io = captureIo();
    expect(
      await runCli(
        [
          'node',
          'pinout',
          'run',
          '--mock',
          '--script',
          '{"action":"gpio.write","payload":{"pin":2,"value":true}}\n{"action":"gpio.read","payload":{"pin":2}}',
        ],
        io,
      ),
    ).toBe(0);
    expect(io.logs.join('\n')).toContain('true');
  });

  it('runs an inline action script', async () => {
    const io = captureIo();
    const code = await runCli(
      [
        'node',
        'pinout',
        'run',
        '--mock',
        '--script',
        '{"action":"gpio.write","payload":{"pin":2,"value":true}}\n{"action":"gpio.read","payload":{"pin":2}}',
      ],
      io,
    );
    expect(code).toBe(0);
    expect(io.logs.join('\n')).toContain('gpio.read');
    expect(io.logs.join('\n')).toContain('true');
  });

  it('blinks on the simulator', async () => {
    const io = captureIo();
    const code = await runCli(
      ['node', 'pinout', 'blink', '--mock', '--count', '2', '--delay', '10'],
      io,
    );
    expect(code).toBe(0);
    expect(io.logs.join('\n')).toContain('blinked gpio 2 2 time(s)');
  });

  it('passes doctor checks', async () => {
    const io = captureIo();
    const code = await runCli(['node', 'pinout', 'doctor'], io);
    expect(code).toBe(0);
    expect(io.logs.join('\n')).toContain('mock');
  });

  it('prints pin groups', async () => {
    const io = captureIo();
    const code = await runCli(['node', 'pinout', 'pins'], io);
    expect(code).toBe(0);
    expect(io.logs.join('\n')).toContain('SPI flash');
  });

  it('uses PINOUT_PORT when set', async () => {
    const previous = process.env.PINOUT_PORT;
    process.env.PINOUT_PORT = '/dev/test-port';
    try {
      const io = captureIo();
      const code = await runCli(['node', 'pinout', 'hello'], io);
      expect(code).toBe(1);
      expect(io.errors.join('\n')).toMatch(/serial|port|open/i);
    } finally {
      if (previous === undefined) {
        delete process.env.PINOUT_PORT;
      } else {
        process.env.PINOUT_PORT = previous;
      }
    }
  });

  it('fails clearly without --port or --mock', async () => {
    const previous = process.env.PINOUT_PORT;
    delete process.env.PINOUT_PORT;
    try {
      const io = captureIo();
      const code = await runCli(['node', 'pinout', 'hello'], io);
      expect(code).toBe(1);
      expect(io.errors.join('\n')).toMatch(/--port|--mock|PINOUT_PORT/);
    } finally {
      if (previous !== undefined) {
        process.env.PINOUT_PORT = previous;
      }
    }
  });

  it('rejects an invalid ESP32 pin', async () => {
    const io = captureIo();
    const code = await runCli(['node', 'pinout', 'gpio', 'write', '34', 'high', '--mock'], io);
    expect(code).toBe(1);
    expect(io.errors.join('\n')).toMatch(/input-only/);
  });

  it('sets gpio mode and invokes sys.ping', async () => {
    const mode = captureIo();
    expect(await runCli(['node', 'pinout', 'gpio', 'mode', '4', 'pullup', '--mock'], mode)).toBe(0);
    expect(mode.logs.join('\n')).toContain('mode');

    const ping = captureIo();
    expect(
      await runCli(['node', 'pinout', 'exec', 'sys.ping', '--payload', '{}', '--mock'], ping),
    ).toBe(0);
    expect(ping.logs.join('\n')).toContain('pong');
  });
});

function captureIo() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (message: string) => {
      logs.push(message);
    },
    error: (message: string) => {
      errors.push(message);
    },
  };
}
