import { connect, simulatedEsp32, type Device } from '@pinout/core';
import type { DoctorCheckResult, DoctorDependencies } from './types.js';

export async function checkSimulator(deps: DoctorDependencies): Promise<DoctorCheckResult> {
  const connectFn = deps.connect ?? connect;
  let device: Device | undefined;

  try {
    device = await connectFn({ transport: simulatedEsp32(), timeoutMs: 5000 });
    const firmware = device.info.firmware;
    const version = device.info.version;

    return {
      stage: 'simulator',
      name: 'mock-handshake',
      status: 'pass',
      detail: `Simulator handshake ok (${firmware} v${version})`,
      meta: { firmware, version, protocol: device.info.protocol },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      stage: 'simulator',
      name: 'mock-handshake',
      status: 'fail',
      detail: `Simulator handshake failed: ${errorMessage}`,
      nextStep: 'Check @pinout/core simulator installation and node runtime integrity.',
    };
  } finally {
    if (device) {
      await device.close().catch(() => undefined);
    }
  }
}
