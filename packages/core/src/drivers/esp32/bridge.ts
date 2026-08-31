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
] as const;

export const esp32BridgeActions = esp32BridgeCapabilities;

export const esp32BridgeInfo: DeviceInfo = {
  firmware: 'esp32-bridge',
  version: '0.1.0',
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
