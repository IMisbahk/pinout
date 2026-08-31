import { describe, expect, it } from 'vitest';
import {
  assertEsp32AdcPin,
  assertEsp32ReadPin,
  assertEsp32WritePin,
  assertGpioMode,
  assertGpioPin,
  assertGpioValue,
  createGpioState,
  handleBridgeAction,
  readPinLevel,
  resolveEsp32BoardPin,
  resolveEsp32DevKitPin,
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

  it('rejects invalid gpio modes', () => {
    expect(() => assertGpioMode('floating')).toThrow(ValidationError);
  });

  it('refuses ESP32 flash, UART0, strap, and input-only output pins', () => {
    expect(() => assertEsp32WritePin(6)).toThrow(/flash/);
    expect(() => assertEsp32WritePin(1)).toThrow(/UART0/);
    expect(() => assertEsp32WritePin(34)).toThrow(/input-only/);
    expect(() => assertEsp32WritePin(12)).toThrow(/strap/);
    expect(() => assertEsp32ReadPin(10)).toThrow(/flash/);
    expect(() => assertEsp32ReadPin(12)).toThrow(/strap/);
  });

  it('allows the usual DevKit LED pin', () => {
    expect(() => assertEsp32WritePin(2)).not.toThrow();
    expect(() => assertEsp32ReadPin(2)).not.toThrow();
  });

  it('allows ADC pins and refuses non-ADC pins for analogRead', () => {
    expect(() => assertEsp32AdcPin(32)).not.toThrow();
    expect(() => assertEsp32AdcPin(2)).toThrow(/ADC/);
    expect(() => assertEsp32AdcPin(12)).toThrow(/ADC/);
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

  it('applies batch writes atomically and stops tracked outputs', () => {
    const state = createGpioState();
    expect(
      handleBridgeAction(
        'gpio.batchWrite',
        {
          writes: [
            { pin: 2, value: true },
            { pin: 4, value: false },
          ],
        },
        state,
      ),
    ).toEqual({
      writes: [
        { pin: 2, value: true },
        { pin: 4, value: false },
      ],
    });
    expect(() =>
      handleBridgeAction(
        'gpio.batchWrite',
        {
          writes: [
            { pin: 13, value: true },
            { pin: 34, value: true },
          ],
        },
        state,
      ),
    ).toThrow(/input-only/);
    expect(readPinLevel(state, 13)).toBe(false);
    expect(handleBridgeAction('gpio.stopAll', {}, state)).toEqual({ stoppedPins: [2, 4] });
    expect(readPinLevel(state, 2)).toBe(false);
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
    expect(result.capabilities).toContain('gpio.mode');
    expect(result.capabilities).toContain('gpio.watch');
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

  it('sets gpio.mode and read respects pull defaults', () => {
    const state = createGpioState();
    expect(handleBridgeAction('gpio.mode', { pin: 4, mode: 'pullup' }, state)).toEqual({
      pin: 4,
      mode: 'pullup',
    });
    expect(readPinLevel(state, 4)).toBe(true);

    expect(handleBridgeAction('gpio.mode', { pin: 5, mode: 'pulldown' }, state)).toEqual({
      pin: 5,
      mode: 'pulldown',
    });
    expect(readPinLevel(state, 5)).toBe(false);
  });

  it('toggles output pins', () => {
    const state = createGpioState();
    handleBridgeAction('gpio.write', { pin: 2, value: false }, state);
    expect(handleBridgeAction('gpio.toggle', { pin: 2 }, state)).toEqual({ pin: 2, value: true });
    expect(handleBridgeAction('gpio.toggle', { pin: 2 }, state)).toEqual({ pin: 2, value: false });
  });

  it('returns pulse metadata for simulator scheduling', () => {
    const state = createGpioState();
    handleBridgeAction('gpio.write', { pin: 2, value: false }, state);
    expect(
      handleBridgeAction('gpio.pulse', { pin: 2, value: true, durationMs: 50 }, state),
    ).toEqual({
      pin: 2,
      value: true,
      durationMs: 50,
      previousValue: false,
    });
  });

  it('configures pwm channels', () => {
    const state = createGpioState();
    expect(
      handleBridgeAction('gpio.pwm', { pin: 2, duty: 0.75, frequency: 1000, channel: 1 }, state),
    ).toEqual({ pin: 2, duty: 0.75, frequency: 1000, channel: 1 });
    expect(() => handleBridgeAction('gpio.pwm', { pin: 2, duty: 1.5 }, state)).toThrow(DeviceError);
    expect(() => handleBridgeAction('gpio.pwm', { pin: 34, duty: 0.5 }, state)).toThrow(
      /input-only/,
    );
  });

  it('reads analog values on ADC pins only', () => {
    const state = createGpioState();
    state.analogLevels.set(32, 2048);
    expect(handleBridgeAction('gpio.analogRead', { pin: 32 }, state)).toEqual({
      pin: 32,
      value: 2048,
    });
    expect(() => handleBridgeAction('gpio.analogRead', { pin: 2 }, state)).toThrow(/ADC/);
  });

  it('tracks watch and unwatch state', () => {
    const state = createGpioState();
    expect(handleBridgeAction('gpio.watch', { pin: 2 }, state)).toEqual({
      pin: 2,
      watching: true,
    });
    expect(handleBridgeAction('gpio.unwatch', { pin: 2 }, state)).toEqual({
      pin: 2,
      watching: false,
    });
  });

  it('emits gpio.changed when a watched pin changes', () => {
    const state = createGpioState();
    const events: Array<Record<string, unknown>> = [];
    handleBridgeAction('gpio.watch', { pin: 2 }, state);
    handleBridgeAction('gpio.write', { pin: 2, value: true }, state, {
      emitEvent: (_event, payload) => events.push(payload),
    });
    expect(events).toEqual([{ pin: 2, value: true }]);
  });
});

describe('esp32 devkit board map', () => {
  it('resolves named pins', () => {
    expect(resolveEsp32DevKitPin('led')).toBe(2);
    expect(resolveEsp32BoardPin('led')).toBe(2);
    expect(() => resolveEsp32DevKitPin('missing')).toThrow(ValidationError);
  });
});
