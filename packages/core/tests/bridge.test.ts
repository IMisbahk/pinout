import { describe, expect, it } from 'vitest';
import {
  assertEsp32ReadPin,
  assertEsp32WritePin,
  assertGpioPin,
  assertGpioValue,
  createGpioState,
  handleBridgeAction,
  ValidationError,
  DeviceError,
} from '@pinout/core';

describe('gpio validation', () => {
  it('rejects non-integer pins', () => {
    expect(() => assertGpioPin(2.5)).toThrow(ValidationError);
    expect(() => assertGpioPin(-1)).toThrow(ValidationError);
    expect(() => assertGpioPin('2')).toThrow(ValidationError);
  });

  it('rejects non-boolean values', () => {
    expect(() => assertGpioValue(1)).toThrow(ValidationError);
    expect(() => assertGpioValue('high')).toThrow(ValidationError);
  });

  it('refuses ESP32 flash, UART0, and input-only output pins', () => {
    expect(() => assertEsp32WritePin(6)).toThrow(/flash/);
    expect(() => assertEsp32WritePin(1)).toThrow(/UART0/);
    expect(() => assertEsp32WritePin(34)).toThrow(/input-only/);
    expect(() => assertEsp32ReadPin(10)).toThrow(/flash/);
  });

  it('allows the usual DevKit LED pin', () => {
    expect(() => assertEsp32WritePin(2)).not.toThrow();
    expect(() => assertEsp32ReadPin(2)).not.toThrow();
  });
});

describe('esp32 bridge handler', () => {
  it('writes and reads back GPIO state', () => {
    const state = createGpioState();
    expect(handleBridgeAction('gpio.write', { pin: 2, value: true }, state)).toEqual({
      pin: 2,
      value: true,
    });
    expect(handleBridgeAction('gpio.read', { pin: 2 }, state)).toEqual({ pin: 2, value: true });
  });

  it('reads unset pins as low', () => {
    expect(handleBridgeAction('gpio.read', { pin: 13 }, createGpioState())).toEqual({
      pin: 13,
      value: false,
    });
  });

  it('returns device identity on hello', () => {
    const result = handleBridgeAction('sys.hello', {}, createGpioState());
    expect(result.firmware).toBe('esp32-bridge');
    expect(result.capabilities).toContain('gpio.write');
  });

  it('rejects unknown actions and invalid pins', () => {
    expect(() => handleBridgeAction('motor.setSpeed', {}, createGpioState())).toThrow(DeviceError);
    expect(() =>
      handleBridgeAction('gpio.write', { pin: 34, value: true }, createGpioState()),
    ).toThrow(/input-only/);
    expect(() =>
      handleBridgeAction('gpio.write', { pin: 2, value: 'high' }, createGpioState()),
    ).toThrow(DeviceError);
  });
});
