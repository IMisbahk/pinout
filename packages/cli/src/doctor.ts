import { connect, listSerialPorts, simulatedEsp32 } from '@pinout/core';
import type { CliOutput } from './output.js';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctor(output: CliOutput): Promise<number> {
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion());
  checks.push(await checkSerialPortModule());
  checks.push(await checkSerialPortList());
  checks.push(await checkMockHandshake());

  if (output.json) {
    output.log({
      ok: checks.every((check) => check.ok),
      checks,
    });
  } else {
    for (const check of checks) {
      const status = check.ok ? 'ok' : 'fail';
      output.log(`${status}  ${check.name}  ${check.detail}`);
    }
  }

  return checks.every((check) => check.ok) ? 0 : 1;
}

function checkNodeVersion(): DoctorCheck {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = Number.isInteger(major) && major >= 20;
  return {
    name: 'node',
    ok,
    detail: ok ? `v${process.versions.node}` : `v${process.versions.node} (need >= 20)`,
  };
}

async function checkSerialPortModule(): Promise<DoctorCheck> {
  try {
    if (typeof listSerialPorts !== 'function') {
      throw new Error('listSerialPorts export is missing.');
    }
    return { name: 'serialport', ok: true, detail: 'module loaded' };
  } catch (error) {
    return {
      name: 'serialport',
      ok: false,
      detail: error instanceof Error ? error.message : 'failed to load serial module',
    };
  }
}

async function checkSerialPortList(): Promise<DoctorCheck> {
  try {
    const ports = await listSerialPorts();
    return {
      name: 'ports',
      ok: true,
      detail: ports.length === 0 ? 'no serial ports found' : `${ports.length} port(s) found`,
    };
  } catch (error) {
    return {
      name: 'ports',
      ok: false,
      detail: error instanceof Error ? error.message : 'failed to list ports',
    };
  }
}

async function checkMockHandshake(): Promise<DoctorCheck> {
  try {
    const device = await connect({ transport: simulatedEsp32(), timeoutMs: 5000 });
    try {
      const firmware = device.info.firmware;
      return { name: 'mock', ok: true, detail: `handshake ok (${firmware})` };
    } finally {
      await device.close();
    }
  } catch (error) {
    return {
      name: 'mock',
      ok: false,
      detail: error instanceof Error ? error.message : 'mock handshake failed',
    };
  }
}
