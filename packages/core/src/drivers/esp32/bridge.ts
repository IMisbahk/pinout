import { DeviceError, ValidationError } from '../../errors.js';
import { protocolVersion } from '../../protocol.js';
import type { DeviceInfo } from '../../types.js';
import {
  assertEsp32AdcPin,
  assertEsp32PwmPin,
  assertEsp32ReadPin,
  assertEsp32WritePin,
  assertGpioMode,
  assertGpioPin,
  assertGpioValue,
  assertI2cAddress,
  assertBusBytes,
  assertBusLength,
  assertEsp32BusPin,
  assertServoAngle,
  assertMotorSpeed,
  esp32DefaultI2c,
  esp32DefaultSpi,
  type GpioPinMode,
} from './pins.js';

export const esp32BridgeCapabilities = [
  'sys.hello',
  'sys.ping',
  'sys.info',
  'gpio.mode',
  'gpio.write',
  'gpio.read',
  'gpio.toggle',
  'gpio.pulse',
  'gpio.pwm',
  'gpio.analogRead',
  'gpio.watch',
  'gpio.unwatch',
  'i2c.begin',
  'i2c.write',
  'i2c.read',
  'i2c.scan',
  'spi.begin',
  'spi.transfer',
  'gpio.servo',
  'gpio.motor',
] as const;

export const esp32BridgeActions = esp32BridgeCapabilities;

export const esp32BridgeInfo: DeviceInfo = {
  firmware: 'esp32-bridge',
  version: '0.2.0',
  protocol: protocolVersion,
  capabilities: [...esp32BridgeCapabilities],
};

export interface PwmChannelState {
  pin: number;
  duty: number;
  frequency: number;
}

export interface GpioState {
  levels: Map<number, boolean>;
  modes: Map<number, GpioPinMode>;
  watched: Set<number>;
  pwmChannels: Map<number, PwmChannelState>;
  analogLevels: Map<number, number>;
  i2c: I2cBusState;
  spi: SpiBusState;
  servos: Map<number, number>;
  motors: Map<number, { speed: number; dirPin?: number }>;
}

export interface I2cBusState {
  sda: number;
  scl: number;
  frequency: number;
  started: boolean;
  memory: Map<number, number[]>;
}

export interface SpiBusState {
  sck: number;
  miso: number;
  mosi: number;
  chipSelect: number;
  frequency: number;
  started: boolean;
  lastTransfer: Map<number, number[]>;
}

export interface BridgeContext {
  emitEvent?: (event: string, payload: Record<string, unknown>) => void;
  schedule?: (task: () => void, delayMs: number) => void;
}

export function createGpioState(): GpioState {
  return {
    levels: new Map(),
    modes: new Map(),
    watched: new Set(),
    pwmChannels: new Map(),
    analogLevels: new Map(),
    i2c: {
      sda: esp32DefaultI2c.sda,
      scl: esp32DefaultI2c.scl,
      frequency: esp32DefaultI2c.frequency,
      started: false,
      memory: new Map(),
    },
    spi: {
      sck: esp32DefaultSpi.sck,
      miso: esp32DefaultSpi.miso,
      mosi: esp32DefaultSpi.mosi,
      chipSelect: esp32DefaultSpi.chipSelect,
      frequency: esp32DefaultSpi.frequency,
      started: false,
      lastTransfer: new Map(),
    },
    servos: new Map(),
    motors: new Map(),
  };
}

export function handleBridgeAction(
  action: string,
  payload: Record<string, unknown>,
  state: GpioState,
  context: BridgeContext = {},
): Record<string, unknown> {
  switch (action) {
    case 'sys.hello':
      return { ...esp32BridgeInfo };
    case 'sys.ping':
      return { pong: true };
    case 'sys.info':
      return { uptimeMs: 0, freeHeap: 200_000 };
    case 'gpio.write':
      return gpioWrite(payload, state, context);
    case 'gpio.read':
      return gpioRead(payload, state);
    case 'gpio.mode':
      return gpioMode(payload, state);
    case 'gpio.toggle':
      return gpioToggle(payload, state, context);
    case 'gpio.pulse':
      return gpioPulse(payload, state, context);
    case 'gpio.pwm':
      return gpioPwm(payload, state);
    case 'gpio.analogRead':
      return gpioAnalogRead(payload, state);
    case 'gpio.watch':
      return gpioWatch(payload, state);
    case 'gpio.unwatch':
      return gpioUnwatch(payload, state);
    case 'i2c.begin':
      return i2cBegin(payload, state);
    case 'i2c.write':
      return i2cWrite(payload, state);
    case 'i2c.read':
      return i2cRead(payload, state);
    case 'i2c.scan':
      return i2cScan(state);
    case 'spi.begin':
      return spiBegin(payload, state);
    case 'spi.transfer':
      return spiTransfer(payload, state);
    case 'gpio.servo':
      return gpioServo(payload, state);
    case 'gpio.motor':
      return gpioMotor(payload, state);
    default:
      throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
  }
}

function gpioWrite(
  payload: Record<string, unknown>,
  state: GpioState,
  context: BridgeContext,
): Record<string, unknown> {
  const pin = requirePin(payload);
  let value: boolean;
  try {
    value = assertGpioValue(payload.value);
  } catch (error) {
    throw new DeviceError(
      'INVALID_PAYLOAD',
      error instanceof Error ? error.message : 'gpio.write requires a boolean value.',
    );
  }
  try {
    assertEsp32WritePin(pin);
  } catch (error) {
    throw asDeviceError(error);
  }
  setPinLevel(state, pin, value, context);
  state.modes.set(pin, 'output');
  return { pin, value };
}

function gpioRead(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  const pin = requirePin(payload);
  try {
    assertEsp32ReadPin(pin);
  } catch (error) {
    throw asDeviceError(error);
  }
  return { pin, value: readPinLevel(state, pin) };
}

function gpioMode(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  const pin = requirePin(payload);
  let mode: GpioPinMode;
  try {
    mode = assertGpioMode(payload.mode);
  } catch (error) {
    throw new DeviceError(
      'INVALID_PAYLOAD',
      error instanceof Error ? error.message : 'gpio.mode requires a valid mode string.',
    );
  }

  if (mode === 'output') {
    try {
      assertEsp32WritePin(pin);
    } catch (error) {
      throw asDeviceError(error);
    }
  } else {
    try {
      assertEsp32ReadPin(pin);
    } catch (error) {
      throw asDeviceError(error);
    }
  }

  state.modes.set(pin, mode);
  if (mode === 'pullup') {
    if (!state.levels.has(pin)) {
      state.levels.set(pin, true);
    }
  } else if (mode === 'pulldown') {
    if (!state.levels.has(pin)) {
      state.levels.set(pin, false);
    }
  }

  return { pin, mode };
}

function gpioToggle(
  payload: Record<string, unknown>,
  state: GpioState,
  context: BridgeContext,
): Record<string, unknown> {
  const pin = requirePin(payload);
  try {
    assertEsp32WritePin(pin);
  } catch (error) {
    throw asDeviceError(error);
  }

  const mode = state.modes.get(pin);
  if (mode !== undefined && mode !== 'output') {
    throw new DeviceError('INVALID_PIN', `GPIO ${pin} must be in output mode before toggle.`);
  }

  const value = !readPinLevel(state, pin);
  setPinLevel(state, pin, value, context);
  state.modes.set(pin, 'output');
  return { pin, value };
}

function gpioPulse(
  payload: Record<string, unknown>,
  state: GpioState,
  context: BridgeContext,
): Record<string, unknown> {
  const pin = requirePin(payload);
  let value = true;
  let durationMs: number;
  try {
    if (payload.value !== undefined) {
      value = assertGpioValue(payload.value);
    }
    durationMs = requireDurationMs(payload.durationMs);
  } catch (error) {
    throw new DeviceError(
      'INVALID_PAYLOAD',
      error instanceof Error ? error.message : 'gpio.pulse requires value and durationMs.',
    );
  }
  try {
    assertEsp32WritePin(pin);
  } catch (error) {
    throw asDeviceError(error);
  }

  const previousValue = readPinLevel(state, pin);
  setPinLevel(state, pin, value, context);
  state.modes.set(pin, 'output');
  return { pin, value, durationMs, previousValue };
}

function gpioPwm(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  const pin = requirePin(payload);
  let duty: number;
  let frequency = 5000;
  let channel = pin % 8;

  try {
    duty = requireDuty(payload.duty);
    if (payload.frequency !== undefined) {
      frequency = requireFrequency(payload.frequency);
    }
    if (payload.channel !== undefined) {
      channel = requirePwmChannel(payload.channel);
    }
  } catch (error) {
    throw new DeviceError(
      'INVALID_PAYLOAD',
      error instanceof Error ? error.message : 'gpio.pwm requires duty between 0 and 1.',
    );
  }

  try {
    assertEsp32PwmPin(pin);
  } catch (error) {
    throw asDeviceError(error);
  }

  state.pwmChannels.set(channel, { pin, duty, frequency });
  state.modes.set(pin, 'output');
  state.levels.set(pin, duty >= 0.5);
  return { pin, duty, frequency, channel };
}

function gpioAnalogRead(
  payload: Record<string, unknown>,
  state: GpioState,
): Record<string, unknown> {
  const pin = requirePin(payload);
  try {
    assertEsp32AdcPin(pin);
  } catch (error) {
    throw asDeviceError(error);
  }

  const stored = state.analogLevels.get(pin);
  if (stored !== undefined) {
    return { pin, value: stored };
  }

  const level = readPinLevel(state, pin);
  return { pin, value: level ? 4095 : 0 };
}

function gpioWatch(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  const pin = requirePin(payload);
  try {
    assertEsp32ReadPin(pin);
  } catch (error) {
    throw asDeviceError(error);
  }
  state.watched.add(pin);
  return { pin, watching: true };
}

function gpioUnwatch(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  const pin = requirePin(payload);
  try {
    assertEsp32ReadPin(pin);
  } catch (error) {
    throw asDeviceError(error);
  }
  state.watched.delete(pin);
  return { pin, watching: false };
}

function i2cBegin(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  try {
    if (payload.sda !== undefined) {
      const sda = assertGpioPin(payload.sda);
      assertEsp32BusPin(sda, 'I2C SDA');
      state.i2c.sda = sda;
    }
    if (payload.scl !== undefined) {
      const scl = assertGpioPin(payload.scl);
      assertEsp32BusPin(scl, 'I2C SCL');
      state.i2c.scl = scl;
    }
    if (payload.frequency !== undefined) {
      state.i2c.frequency = requirePositiveInt(payload.frequency, 'frequency');
    }
  } catch (error) {
    throw asDeviceError(error);
  }
  state.i2c.started = true;
  return { sda: state.i2c.sda, scl: state.i2c.scl, frequency: state.i2c.frequency };
}

function i2cWrite(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  let address: number;
  let data: number[];
  try {
    address = assertI2cAddress(payload.address);
    data = assertBusBytes(payload.data, 'data');
  } catch (error) {
    throw asPayloadError(error);
  }
  state.i2c.started = true;
  state.i2c.memory.set(address, [...data]);
  return { address, bytesWritten: data.length };
}

function i2cRead(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  let address: number;
  let length: number;
  try {
    address = assertI2cAddress(payload.address);
    length = assertBusLength(payload.length);
  } catch (error) {
    throw asPayloadError(error);
  }
  state.i2c.started = true;
  const stored = state.i2c.memory.get(address) ?? [];
  const data = Array.from({ length }, (_, index) => stored[index] ?? 0);
  return { address, data };
}

function i2cScan(state: GpioState): Record<string, unknown> {
  state.i2c.started = true;
  return { addresses: [...state.i2c.memory.keys()].sort((a, b) => a - b) };
}

function spiBegin(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  try {
    if (payload.sck !== undefined) {
      const sck = assertGpioPin(payload.sck);
      assertEsp32BusPin(sck, 'SPI SCK');
      state.spi.sck = sck;
    }
    if (payload.miso !== undefined) {
      const miso = assertGpioPin(payload.miso);
      assertEsp32ReadPin(miso);
      state.spi.miso = miso;
    }
    if (payload.mosi !== undefined) {
      const mosi = assertGpioPin(payload.mosi);
      assertEsp32BusPin(mosi, 'SPI MOSI');
      state.spi.mosi = mosi;
    }
    if (payload.chipSelect !== undefined) {
      const chipSelect = assertGpioPin(payload.chipSelect);
      assertEsp32BusPin(chipSelect, 'SPI chip-select');
      state.spi.chipSelect = chipSelect;
    }
    if (payload.frequency !== undefined) {
      state.spi.frequency = requirePositiveInt(payload.frequency, 'frequency');
    }
  } catch (error) {
    throw asDeviceError(error);
  }
  state.spi.started = true;
  return {
    sck: state.spi.sck,
    miso: state.spi.miso,
    mosi: state.spi.mosi,
    chipSelect: state.spi.chipSelect,
    frequency: state.spi.frequency,
  };
}

function spiTransfer(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  let data: number[];
  try {
    data = assertBusBytes(payload.data, 'data');
  } catch (error) {
    throw asPayloadError(error);
  }
  let chipSelect = state.spi.chipSelect;
  if (payload.chipSelect !== undefined) {
    try {
      chipSelect = assertGpioPin(payload.chipSelect);
      assertEsp32BusPin(chipSelect, 'SPI chip-select');
    } catch (error) {
      throw asDeviceError(error);
    }
  }
  state.spi.started = true;
  state.spi.lastTransfer.set(chipSelect, [...data]);
  return { chipSelect, data: [...data] };
}

function gpioServo(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  const pin = requirePin(payload);
  try {
    assertEsp32PwmPin(pin);
  } catch (error) {
    throw asDeviceError(error);
  }
  let angle: number;
  try {
    angle = assertServoAngle(payload.angle);
  } catch (error) {
    throw asPayloadError(error);
  }
  state.servos.set(pin, angle);
  state.modes.set(pin, 'output');
  return { pin, angle };
}

function gpioMotor(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  let pwmPin: number;
  let dirPin: number | undefined;
  try {
    pwmPin = assertGpioPin(payload.pwmPin);
    assertEsp32PwmPin(pwmPin);
    if (payload.dirPin !== undefined) {
      dirPin = assertGpioPin(payload.dirPin);
      assertEsp32WritePin(dirPin);
    }
  } catch (error) {
    throw asDeviceError(error);
  }
  let speed: number;
  try {
    speed = assertMotorSpeed(payload.speed, dirPin !== undefined);
  } catch (error) {
    throw asPayloadError(error);
  }
  const motor: { speed: number; dirPin?: number } = { speed };
  if (dirPin !== undefined) {
    motor.dirPin = dirPin;
    state.modes.set(dirPin, 'output');
    state.levels.set(dirPin, speed >= 0);
  }
  state.motors.set(pwmPin, motor);
  state.modes.set(pwmPin, 'output');
  state.pwmChannels.set(pwmPin % 8, { pin: pwmPin, duty: Math.abs(speed), frequency: 1000 });
  return dirPin === undefined ? { pwmPin, speed } : { pwmPin, dirPin, speed };
}

export function readPinLevel(state: GpioState, pin: number): boolean {
  const mode = state.modes.get(pin);
  if (mode === 'pullup') {
    return state.levels.get(pin) ?? true;
  }
  if (mode === 'pulldown') {
    return state.levels.get(pin) ?? false;
  }
  return state.levels.get(pin) ?? false;
}

export function setPinLevel(
  state: GpioState,
  pin: number,
  value: boolean,
  context: BridgeContext,
): void {
  const previous = readPinLevel(state, pin);
  state.levels.set(pin, value);
  if (previous !== value && state.watched.has(pin)) {
    context.emitEvent?.('gpio.changed', { pin, value });
  }
}

function requirePin(payload: Record<string, unknown>): number {
  try {
    return assertGpioPin(payload.pin);
  } catch (error) {
    throw asDeviceError(error);
  }
}

function requireDurationMs(durationMs: unknown): number {
  if (typeof durationMs !== 'number' || !Number.isInteger(durationMs) || durationMs <= 0) {
    throw new ValidationError('gpio.pulse durationMs must be a positive integer.');
  }
  return durationMs;
}

function requireDuty(duty: unknown): number {
  if (typeof duty !== 'number' || duty < 0 || duty > 1) {
    throw new ValidationError('gpio.pwm duty must be a number between 0 and 1.');
  }
  return duty;
}

function requireFrequency(frequency: unknown): number {
  if (typeof frequency !== 'number' || !Number.isFinite(frequency) || frequency <= 0) {
    throw new ValidationError('gpio.pwm frequency must be a positive number.');
  }
  return frequency;
}

function requirePwmChannel(channel: unknown): number {
  if (typeof channel !== 'number' || !Number.isInteger(channel) || channel < 0 || channel > 15) {
    throw new ValidationError('gpio.pwm channel must be an integer between 0 and 15.');
  }
  return channel;
}

function requirePositiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive integer.`);
  }
  return value;
}

function asPayloadError(error: unknown): DeviceError {
  if (error instanceof DeviceError) {
    return error;
  }
  return new DeviceError(
    'INVALID_PAYLOAD',
    error instanceof Error ? error.message : 'Invalid payload.',
  );
}

function asDeviceError(error: unknown): DeviceError {
  if (error instanceof ValidationError) {
    return new DeviceError('INVALID_PIN', error.message);
  }
  if (error instanceof DeviceError) {
    return error;
  }
  return new DeviceError(
    'INVALID_PAYLOAD',
    error instanceof Error ? error.message : 'Invalid payload.',
  );
}
