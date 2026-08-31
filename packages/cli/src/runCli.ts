import { Command, InvalidArgumentError } from 'commander';
import { connect, simulatedEsp32 } from '@pinout/core';
import type { Device } from '@pinout/core';

export interface CliIo {
  log: (message: string) => void;
  error: (message: string) => void;
}

const defaultIo: CliIo = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const program = new Command();
  program.name('pinout').description('Control hardware through the Pinout SDK.').helpCommand(false);

  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => io.log(str.replace(/\n$/, '')),
    writeErr: (str) => io.error(str.replace(/\n$/, '')),
  });

  program
    .command('devices')
    .description('List serial ports on this machine.')
    .action(async () => {
      const { listSerialPorts } = await import('@pinout/core/serial');
      const ports = await listSerialPorts();
      if (ports.length === 0) {
        io.log('No serial ports found.');
        return;
      }
      for (const port of ports) {
        const extra = [port.manufacturer, port.serialNumber].filter(Boolean).join(', ');
        io.log(extra ? `${port.path}  (${extra})` : port.path);
      }
    });

  addDeviceOptions(
    program.command('hello').description('Connect, handshake, and print device capabilities.'),
  ).action(async (options: DeviceCliOptions) => {
    const device = await openDevice(options);
    try {
      printHello(device, io);
    } finally {
      await device.close();
    }
  });

  const gpio = program.command('gpio').description('GPIO operations.');

  addDeviceOptions(
    gpio
      .command('write')
      .description('Drive a pin high or low.')
      .argument('<pin>', 'GPIO pin number', parsePin)
      .argument('<value>', 'high|low|true|false|1|0', parseLevel),
  ).action(async (pin: number, value: boolean, options: DeviceCliOptions) => {
    const device = await openDevice(options);
    try {
      await device.gpio.write(pin, value);
      io.log(`gpio ${pin} -> ${value ? 'high' : 'low'}`);
    } finally {
      await device.close();
    }
  });

  addDeviceOptions(
    gpio
      .command('read')
      .description('Read a pin level.')
      .argument('<pin>', 'GPIO pin number', parsePin),
  ).action(async (pin: number, options: DeviceCliOptions) => {
    const device = await openDevice(options);
    try {
      const value = await device.gpio.read(pin);
      io.log(value ? 'high' : 'low');
    } finally {
      await device.close();
    }
  });

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (isCommanderHelp(error)) {
      return 0;
    }
    io.error(formatError(error));
    return 1;
  }
}

interface DeviceCliOptions {
  port?: string;
  mock?: boolean;
  baud: number;
  timeout: number;
}

function addDeviceOptions(command: Command): Command {
  return command
    .option('-p, --port <path>', 'serial port path, for example /dev/cu.usbserial-10')
    .option('--mock', 'use the simulated ESP32 instead of hardware', false)
    .option('--baud <rate>', 'serial baud rate', parsePositiveInt, 115200)
    .option('--timeout <ms>', 'request timeout in milliseconds', parsePositiveInt, 5000);
}

async function openDevice(options: DeviceCliOptions): Promise<Device> {
  if (options.mock && options.port) {
    throw new Error('Use either --mock or --port, not both.');
  }
  if (!options.mock && !options.port) {
    throw new Error('Provide --port <path> for hardware, or --mock to use the simulator.');
  }

  if (options.mock) {
    return connect({ transport: simulatedEsp32(), timeoutMs: options.timeout });
  }

  const { serialPort } = await import('@pinout/core/serial');
  return connect({
    transport: serialPort({ path: options.port as string, baudRate: options.baud }),
    timeoutMs: options.timeout,
  });
}

function printHello(device: Device, io: CliIo): void {
  io.log(`firmware    ${device.info.firmware} ${device.info.version}`);
  io.log(`protocol    v${device.info.protocol}`);
  io.log('capabilities');
  for (const capability of device.capabilities) {
    const safety = capability.safety.physicalOutput ? 'physical-output' : 'read-only';
    io.log(`  ${capability.name}  (${safety})  ${capability.description}`);
  }
}

function parsePin(value: string): number {
  const pin = Number(value);
  if (!Number.isInteger(pin) || pin < 0) {
    throw new InvalidArgumentError('Pin must be a non-negative integer.');
  }
  return pin;
}

function parseLevel(value: string): boolean {
  const normalized = value.toLowerCase();
  if (['high', 'true', '1', 'on'].includes(normalized)) {
    return true;
  }
  if (['low', 'false', '0', 'off'].includes(normalized)) {
    return false;
  }
  throw new InvalidArgumentError('Value must be high, low, true, false, 1, or 0.');
}

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Expected a positive integer.');
  }
  return parsed;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isCommanderHelp(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'commander.helpDisplayed' ||
      error.code === 'commander.help' ||
      error.code === 'commander.version')
  );
}
