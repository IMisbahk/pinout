import { describe, expect, it } from 'vitest';
import {
  DeviceError,
  ValidationError,
  connect,
  createGpioState,
  handleBridgeAction,
  simulatedEsp32,
} from '@pinout/core';

describe('ESP32 I2C simulator', () => {
  it('writes then reads back stored bytes', () => {
    const state = createGpioState();
    state.deviceState = 'armed';
    expect(handleBridgeAction('i2c.begin', {}, state)).toMatchObject({
      sda: 21,
      scl: 22,
      frequency: 100_000,
    });
    expect(handleBridgeAction('i2c.write', { address: 0x3c, data: [0x00, 0xaf] }, state)).toEqual({
      address: 0x3c,
      bytesWritten: 2,
    });
    expect(handleBridgeAction('i2c.read', { address: 0x3c, length: 2 }, state)).toEqual({
      address: 0x3c,
      data: [0x00, 0xaf],
    });
    expect(handleBridgeAction('i2c.scan', {}, state)).toEqual({ addresses: [0x3c] });
  });

  it('rejects invalid I2C addresses', () => {
    const state = createGpioState();
    state.deviceState = 'armed';
    expect(() => handleBridgeAction('i2c.write', { address: 200, data: [1] }, state)).toThrow(
      DeviceError,
    );
  });

  it('refuses flash pins for I2C begin', () => {
    expect(() => handleBridgeAction('i2c.begin', { sda: 6 }, createGpioState())).toThrow(/flash/);
  });
});

describe('ESP32 SPI simulator', () => {
  it('loopback-transfers bytes on the default chip-select', () => {
    const state = createGpioState();
    state.deviceState = 'armed';
    expect(handleBridgeAction('spi.begin', {}, state)).toMatchObject({
      sck: 18,
      miso: 19,
      mosi: 23,
      chipSelect: 5,
    });
    expect(handleBridgeAction('spi.transfer', { data: [0x12, 0x34] }, state)).toEqual({
      chipSelect: 5,
      data: [0x12, 0x34],
    });
  });
});

describe('ESP32 GPIO servo and motor', () => {
  it('commands a servo angle on a PWM pin', () => {
    const state = createGpioState();
    state.deviceState = 'armed';
    expect(handleBridgeAction('gpio.servo', { pin: 13, angle: 90 }, state)).toEqual({
      pin: 13,
      angle: 90,
    });
  });

  it('drives a motor with optional reverse', () => {
    const state = createGpioState();
    state.deviceState = 'armed';
    expect(
      handleBridgeAction('gpio.motor', { pwmPin: 25, dirPin: 26, speed: -0.4 }, state),
    ).toEqual({ pwmPin: 25, dirPin: 26, speed: -0.4 });
    expect(() => handleBridgeAction('gpio.motor', { pwmPin: 25, speed: -0.4 }, state)).toThrow(
      /direction pin/,
    );
  });
});

describe('ESP32 bus capabilities via Device', () => {
  it('advertises i2c and spi actions and round-trips through the protocol', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      expect(device.supports('i2c.write')).toBe(true);
      expect(device.supports('spi.transfer')).toBe(true);
      expect(device.info.version).toBe('0.3.0');
      await device.arm();

      await device.invoke('i2c.write', { address: 0x48, data: [0x01, 0x02] });
      await expect(device.invoke('i2c.read', { address: 0x48, length: 2 })).resolves.toEqual({
        address: 0x48,
        data: [0x01, 0x02],
      });
      await expect(device.invoke('spi.transfer', { data: [9, 8, 7] })).resolves.toMatchObject({
        data: [9, 8, 7],
      });
      await expect(device.invoke('i2c.write', { address: 0x48, data: [] })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(device.invoke('i2c.begin', { sda: 12 })).rejects.toBeInstanceOf(ValidationError);
      await expect(device.invoke('gpio.servo', { pin: 13, angle: 45 })).resolves.toEqual({
        pin: 13,
        angle: 45,
      });
      await expect(
        device.invoke('gpio.motor', { pwmPin: 25, dirPin: 26, speed: 0.5 }),
      ).resolves.toMatchObject({ pwmPin: 25, speed: 0.5 });
    } finally {
      await device.close();
    }
  });
});
