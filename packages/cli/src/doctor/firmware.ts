import {
  connect,
  protocolVersion,
  readDevicesFile,
  serialPort,
  simulatedEsp32,
  type Device,
  type Transport,
} from '@pinout/core';
import type {
  DoctorCheckResult,
  DoctorDependencies,
  DoctorOptions,
  SerialPortEntry,
} from './types.js';

export async function checkFirmware(
  options: DoctorOptions,
  deps: DoctorDependencies,
  discoveredPorts: SerialPortEntry[],
): Promise<DoctorCheckResult> {
  const targetResolution = resolveTarget(options, deps, discoveredPorts);

  if (targetResolution.kind === 'skip') {
    return {
      stage: 'firmware',
      name: 'firmware-identity',
      status: 'skip',
      detail: targetResolution.reason,
      nextStep: targetResolution.nextStep,
    };
  }

  if (targetResolution.kind === 'fail') {
    return {
      stage: 'firmware',
      name: 'firmware-identity',
      status: 'fail',
      detail: targetResolution.reason,
      nextStep: targetResolution.nextStep,
    };
  }

  const { targetName, isMock, portPath } = targetResolution;
  const timeoutMs = options.timeoutMs ?? 3000;
  const connectFn = deps.connect ?? connect;

  let transport: Transport;
  if (isMock) {
    transport = simulatedEsp32();
  } else if (deps.createSerialTransport) {
    transport = deps.createSerialTransport({ path: portPath!, baudRate: 115200 });
  } else {
    transport = serialPort({ path: portPath!, baudRate: 115200 });
  }

  let device: Device | undefined;
  try {
    // Only perform the non-actuating identity handshake (sys.hello).
    // Never send any actuation, gpio, pwm, or arming commands during diagnostic probing.
    device = await connectFn({ transport, timeoutMs });
    const info = device.info;

    // Check protocol version
    if (info.protocol !== protocolVersion) {
      return {
        stage: 'firmware',
        name: `firmware-identity:${targetName}`,
        status: 'fail',
        detail: `Protocol version mismatch on ${targetName}: device reports v${info.protocol}, host expects v${protocolVersion}.`,
        nextStep:
          'Flash matching firmware per firmware/esp32-bridge/README.md or update the Pinout SDK so protocol versions match.',
        meta: {
          target: targetName,
          firmware: info.firmware,
          version: info.version,
          reportedProtocol: info.protocol,
          expectedProtocol: protocolVersion,
        },
      };
    }

    // Check watchdog and arming features defensively
    const features: string[] = Array.isArray(info.features) ? info.features : [];
    const hasWatchdog = features.includes('watchdog');
    const hasArming = features.includes('arming');

    if (!hasWatchdog || !hasArming) {
      return {
        stage: 'firmware',
        name: `firmware-identity:${targetName}`,
        status: 'warn',
        detail: `Firmware '${info.firmware}' v${info.version} on ${targetName} does not advertise watchdog/arming; sustained actuation not supported.`,
        nextStep:
          'Update to modern firmware supporting command watchdog and explicit arming per firmware/esp32-bridge/README.md.',
        meta: {
          target: targetName,
          firmware: info.firmware,
          version: info.version,
          protocol: info.protocol,
          features,
          capabilities: info.capabilities,
        },
      };
    }

    return {
      stage: 'firmware',
      name: `firmware-identity:${targetName}`,
      status: 'pass',
      detail: `Firmware '${info.firmware}' v${info.version} (protocol v${info.protocol}, features: ${features.join(', ')}) ready on ${targetName}.`,
      meta: {
        target: targetName,
        firmware: info.firmware,
        version: info.version,
        protocol: info.protocol,
        features,
        capabilities: info.capabilities,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      stage: 'firmware',
      name: `firmware-identity:${targetName}`,
      status: 'fail',
      detail: `No Pinout firmware responded on ${targetName} (${errorMessage}).`,
      nextStep:
        'Flash Pinout bridge firmware to the board per firmware/esp32-bridge/README.md; ensure 115200 baud and proper USB connection.',
      meta: { target: targetName, error: errorMessage },
    };
  } finally {
    if (device) {
      await device.close().catch(() => undefined);
    }
  }
}

type TargetResolution =
  | { kind: 'probe'; targetName: string; isMock: boolean; portPath?: string }
  | { kind: 'skip'; reason: string; nextStep?: string }
  | { kind: 'fail'; reason: string; nextStep: string };

function resolveTarget(
  options: DoctorOptions,
  deps: DoctorDependencies,
  ports: SerialPortEntry[],
): TargetResolution {
  if (options.mock) {
    return { kind: 'probe', targetName: 'simulator', isMock: true };
  }

  if (options.port) {
    return { kind: 'probe', targetName: options.port, isMock: false, portPath: options.port };
  }

  if (options.device) {
    const readFn = deps.readDevicesFile ?? readDevicesFile;
    const devicesFile = readFn(undefined, deps.home);
    const configured = devicesFile.devices.find((entry) => entry.id === options.device);
    if (!configured) {
      return {
        kind: 'fail',
        reason: `Configured device '${options.device}' not found in registry.`,
        nextStep: `Check available devices with 'pinout devices' or enroll with 'pinout enroll --id ${options.device}'.`,
      };
    }
    if (
      configured.backend?.type === 'simulated' ||
      configured.backend?.transport?.type === 'simulated-esp32'
    ) {
      return {
        kind: 'probe',
        targetName: `device:${options.device} (simulator)`,
        isMock: true,
      };
    }
    const path = configured.backend?.transport?.path;
    if (path) {
      return {
        kind: 'probe',
        targetName: `device:${options.device} (${path})`,
        isMock: false,
        portPath: path,
      };
    }
    return {
      kind: 'fail',
      reason: `Device '${options.device}' has no serial port configured.`,
      nextStep: `Configure a transport path for '${options.device}' in ~/.pinout/devices.json.`,
    };
  }

  if (ports.length === 1) {
    return {
      kind: 'probe',
      targetName: ports[0]!.path,
      isMock: false,
      portPath: ports[0]!.path,
    };
  }

  if (ports.length > 1) {
    const portList = ports.map((port) => port.path).join(', ');
    return {
      kind: 'skip',
      reason: `Multiple serial ports detected (${portList}). Specify which port to probe with '--port <path>' or '--device <id>'.`,
      nextStep: `Run 'pinout doctor --port <path>' to probe a specific hardware port.`,
    };
  }

  return {
    kind: 'skip',
    reason: 'No serial ports detected to probe firmware identity.',
    nextStep:
      'Connect an ESP32 board via USB data cable, or pass --mock / test with simulator.',
  };
}
