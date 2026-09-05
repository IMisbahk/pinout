import { readDevicesFile, resolvePinoutHome } from '@pinout/core';
import type { DoctorCheckResult, DoctorDependencies, SerialPortEntry } from './types.js';

export function checkConfiguration(
  deps: DoctorDependencies,
  discoveredPorts: SerialPortEntry[],
): DoctorCheckResult[] {
  const checks: DoctorCheckResult[] = [];
  const readFn = deps.readDevicesFile ?? readDevicesFile;
  const home = resolvePinoutHome(deps.home);

  try {
    const devicesFile = readFn(undefined, deps.home);
    const devices = devicesFile.devices;

    if (devices.length === 0) {
      checks.push({
        stage: 'configuration',
        name: 'enrolled-devices',
        status: 'warn',
        detail: `No devices configured in ${home}/devices.json.`,
        nextStep:
          'Enroll a device using "pinout enroll --id <name> --port <path>" (or "--mock") or follow docs/setup.md.',
        meta: { count: 0 },
      });
      return checks;
    }

    checks.push({
      stage: 'configuration',
      name: 'enrolled-devices',
      status: 'pass',
      detail: `${devices.length} device(s) configured in ${home}/devices.json.`,
      meta: { count: devices.length },
    });

    const activePortPaths = new Set(discoveredPorts.map((port) => port.path));

    for (const device of devices) {
      const backendType = device.backend?.type;
      const transportType = device.backend?.transport?.type;
      const transportPath = device.backend?.transport?.path;

      if (backendType === 'simulated' || transportType === 'simulated-esp32') {
        checks.push({
          stage: 'configuration',
          name: `device:${device.id}`,
          status: 'pass',
          detail: `Device '${device.id}' (${device.module}) configured with simulated backend.`,
          meta: { deviceId: device.id, module: device.module, simulated: true },
        });
      } else if (transportType === 'serial' && transportPath) {
        if (activePortPaths.has(transportPath)) {
          checks.push({
            stage: 'configuration',
            name: `device:${device.id}`,
            status: 'pass',
            detail: `Device '${device.id}' (${device.module}) port '${transportPath}' is present.`,
            meta: {
              deviceId: device.id,
              module: device.module,
              port: transportPath,
              present: true,
            },
          });
        } else {
          checks.push({
            stage: 'configuration',
            name: `device:${device.id}`,
            status: 'warn',
            detail: `Device '${device.id}' (${device.module}) expects port '${transportPath}' which is not currently detected on host.`,
            nextStep: `Connect device '${device.id}' to USB port '${transportPath}' or update ~/.pinout/devices.json.`,
            meta: {
              deviceId: device.id,
              module: device.module,
              port: transportPath,
              present: false,
            },
          });
        }
      } else {
        checks.push({
          stage: 'configuration',
          name: `device:${device.id}`,
          status: 'pass',
          detail: `Device '${device.id}' (${device.module}) configured (transport: ${transportType ?? 'default'}).`,
          meta: { deviceId: device.id, module: device.module, transport: transportType },
        });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    checks.push({
      stage: 'configuration',
      name: 'enrolled-devices',
      status: 'fail',
      detail: `Failed to read device configuration: ${errorMessage}`,
      nextStep: `Inspect and fix syntax or permissions in ${home}/devices.json.`,
    });
  }

  return checks;
}
