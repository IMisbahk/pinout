import { DeviceError, ValidationError } from '../../errors.js';
import { protocolVersion } from '../../protocol.js';
import type { DeviceInfo } from '../../types.js';
import { assertEsp32ReadPin, assertEsp32WritePin, assertGpioPin, assertGpioValue } from './pins.js';

export const esp32BridgeInfo: DeviceInfo = {
  firmware: 'esp32-bridge',
  version: '0.1.0',
  protocol: protocolVersion,
  capabilities: ['sys.hello', 'gpio.write', 'gpio.read'],
};

export interface GpioState {
  levels: Map<number, boolean>;
}

export function createGpioState(): GpioState {
  return { levels: new Map() };
}

export function handleBridgeAction(
  action: string,
  payload: Record<string, unknown>,
  state: GpioState,
): Record<string, unknown> {
  switch (action) {
    case 'sys.hello':
      return { ...esp32BridgeInfo };
    case 'gpio.write':
      return gpioWrite(payload, state);
    case 'gpio.read':
      return gpioRead(payload, state);
    default:
      throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
  }
}

function gpioWrite(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
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
  state.levels.set(pin, value);
  return { pin, value };
}

function gpioRead(payload: Record<string, unknown>, state: GpioState): Record<string, unknown> {
  const pin = requirePin(payload);
  try {
    assertEsp32ReadPin(pin);
  } catch (error) {
    throw asDeviceError(error);
  }
  return { pin, value: state.levels.get(pin) ?? false };
}

function requirePin(payload: Record<string, unknown>): number {
  try {
    return assertGpioPin(payload.pin);
  } catch (error) {
    throw asDeviceError(error);
  }
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
