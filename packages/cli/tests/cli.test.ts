import { describe, expect, it } from 'vitest';
import { runCli } from '../src/runCli.js';

describe('cli', () => {
  it('handshakes with the simulator', async () => {
    const io = captureIo();
    const code = await runCli(['node', 'pinout', 'hello', '--mock'], io);
    expect(code).toBe(0);
    expect(io.logs.join('\n')).toContain('esp32-bridge');
    expect(io.logs.join('\n')).toContain('gpio.write');
  });

  it('writes and reads GPIO through the same SDK path', async () => {
    const write = captureIo();
    expect(await runCli(['node', 'pinout', 'gpio', 'write', '2', 'high', '--mock'], write)).toBe(0);
    expect(write.logs.join('\n')).toContain('gpio 2 -> high');

    const read = captureIo();
    expect(await runCli(['node', 'pinout', 'gpio', 'read', '2', '--mock'], read)).toBe(0);
    expect(read.logs).toEqual(['low']);
  });

  it('fails clearly without --port or --mock', async () => {
    const io = captureIo();
    const code = await runCli(['node', 'pinout', 'hello'], io);
    expect(code).toBe(1);
    expect(io.errors.join('\n')).toMatch(/--port|--mock/);
  });

  it('rejects an invalid ESP32 pin', async () => {
    const io = captureIo();
    const code = await runCli(['node', 'pinout', 'gpio', 'write', '34', 'high', '--mock'], io);
    expect(code).toBe(1);
    expect(io.errors.join('\n')).toMatch(/input-only/);
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
