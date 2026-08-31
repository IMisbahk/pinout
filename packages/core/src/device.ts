import { UnsupportedCapabilityError, ValidationError } from './errors.js';
import { describeCapability, describeCapabilities, toAgentTools } from './capabilities.js';
import { validateInputSchema } from './schema.js';
import {
  assertBusBytes,
  assertBusLength,
  assertEsp32AnalogPin,
  assertEsp32BusPin,
  assertEsp32ModePin,
  assertEsp32PwmPin,
  assertEsp32ReadPin,
  assertEsp32WritePin,
  assertGpioMode,
  assertGpioPin,
  assertGpioValue,
  assertI2cAddress,
  resolveEsp32BoardPin,
} from './drivers/esp32/pins.js';
import type { Session } from './session.js';
import type { AgentTool, CapabilityDescriptor, DeviceEventHandler, DeviceInfo } from './types.js';

export class Device {
  readonly capabilities: CapabilityDescriptor[];
  readonly gpio: Gpio;
  private readonly handlers = new Map<string, Set<DeviceEventHandler>>();
  private readonly onceHandlers = new Map<string, Set<DeviceEventHandler>>();
  private removeEventListener: (() => void) | undefined;

  constructor(
    readonly info: DeviceInfo,
    private readonly session: Session,
  ) {
    this.capabilities = describeCapabilities(info.capabilities);
    this.gpio = new Gpio(this);
    this.removeEventListener = session.addEventListener((event) => {
      if (event.event === 'ready') {
        return;
      }
      this.emit(event.event, event.payload);
    });
  }

  supports(action: string): boolean {
    return this.info.capabilities.includes(action);
  }

  on(event: string, handler: DeviceEventHandler): void {
    this.addHandler(this.handlers, event, handler);
  }

  off(event: string, handler: DeviceEventHandler): void {
    this.handlers.get(event)?.delete(handler);
    this.onceHandlers.get(event)?.delete(handler);
  }

  once(event: string, handler: DeviceEventHandler): void {
    this.addHandler(this.onceHandlers, event, handler);
  }

  async invoke(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (!this.supports(action)) {
      throw new UnsupportedCapabilityError(action);
    }
    const descriptor = describeCapability(action);
    const checked = validateInputSchema(descriptor.inputSchema, payload);
    const normalized = validateAction(this.info.firmware, action, checked);
    return this.session.request(action, normalized);
  }

  toAgentTools(): AgentTool[] {
    return toAgentTools(this.capabilities);
  }

  async close(): Promise<void> {
    this.removeEventListener?.();
    this.removeEventListener = undefined;
    this.handlers.clear();
    this.onceHandlers.clear();
    await this.session.close();
  }

  private emit(event: string, payload: Record<string, unknown>): void {
    this.dispatch(this.handlers.get(event), payload);
    const once = this.onceHandlers.get(event);
    if (once) {
      this.dispatch(once, payload);
      this.onceHandlers.delete(event);
    }
  }

  private dispatch(
    handlers: Set<DeviceEventHandler> | undefined,
    payload: Record<string, unknown>,
  ): void {
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(payload);
    }
  }

  private addHandler(
    store: Map<string, Set<DeviceEventHandler>>,
    event: string,
    handler: DeviceEventHandler,
  ): void {
    const handlers = store.get(event);
    if (handlers) {
      handlers.add(handler);
      return;
    }
    store.set(event, new Set([handler]));
  }
}

class Gpio {
  constructor(private readonly device: Device) {}

  async mode(pin: number, mode: 'input' | 'output' | 'pullup' | 'pulldown'): Promise<void> {
    await this.device.invoke('gpio.mode', { pin, mode });
  }

  async write(pin: number, value: boolean): Promise<void> {
    await this.device.invoke('gpio.write', { pin, value });
  }

  async read(pin: number): Promise<boolean> {
    const result = await this.device.invoke('gpio.read', { pin });
    if (typeof result.value !== 'boolean') {
      throw new ValidationError('gpio.read returned a non-boolean value.');
    }
    return result.value;
  }

  async toggle(pin: number): Promise<boolean> {
    const result = await this.device.invoke('gpio.toggle', { pin });
    if (typeof result.value !== 'boolean') {
      throw new ValidationError('gpio.toggle returned a non-boolean value.');
    }
    return result.value;
  }

  async pulse(pin: number, durationMs: number, value = true): Promise<void> {
    await this.device.invoke('gpio.pulse', { pin, durationMs, value });
  }

  async pwm(channel: number, pin: number, duty: number, frequency: number): Promise<void> {
    await this.device.invoke('gpio.pwm', { channel, pin, duty, frequency });
  }

  async analogRead(pin: number): Promise<number> {
    const result = await this.device.invoke('gpio.analogRead', { pin });
    if (typeof result.value !== 'number') {
      throw new ValidationError('gpio.analogRead returned a non-numeric value.');
    }
    return result.value;
  }

  async watch(pin: number): Promise<void> {
    await this.device.invoke('gpio.watch', { pin });
  }

  async unwatch(pin: number): Promise<void> {
    await this.device.invoke('gpio.unwatch', { pin });
  }

  resolveBoardPin(name: string): number {
    if (this.device.info.firmware === 'esp32-bridge') {
      return resolveEsp32BoardPin(name);
    }
    throw new ValidationError(
      `Board pin names are not defined for '${this.device.info.firmware}'.`,
    );
  }
}

function validateAction(
  firmware: string,
  action: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (action === 'sys.hello' || action === 'sys.ping' || action === 'sys.info') {
    assertEmptyPayload(payload, action);
    return {};
  }

  if (firmware !== 'esp32-bridge') {
    return payload;
  }

  switch (action) {
    case 'gpio.mode': {
      const pin = assertGpioPin(payload.pin);
      assertEsp32ModePin(pin);
      return { pin, mode: assertGpioMode(payload.mode) };
    }
    case 'gpio.write': {
      const pin = assertGpioPin(payload.pin);
      assertEsp32WritePin(pin);
      return { pin, value: assertGpioValue(payload.value) };
    }
    case 'gpio.read':
    case 'gpio.watch':
    case 'gpio.unwatch': {
      const pin = assertGpioPin(payload.pin);
      assertEsp32ReadPin(pin);
      return { pin };
    }
    case 'gpio.toggle':
    case 'gpio.pulse': {
      const pin = assertGpioPin(payload.pin);
      assertEsp32WritePin(pin);
      if (action === 'gpio.toggle') {
        return { pin };
      }
      return {
        pin,
        durationMs: assertPositiveInt(payload.durationMs, 'durationMs'),
        value: payload.value === undefined ? true : assertGpioValue(payload.value),
      };
    }
    case 'gpio.pwm': {
      const pin = assertGpioPin(payload.pin);
      assertEsp32PwmPin(pin);
      return {
        channel: payload.channel === undefined ? pin % 8 : assertChannel(payload.channel),
        pin,
        duty: assertDuty(payload.duty),
        frequency:
          payload.frequency === undefined
            ? 5000
            : assertPositiveInt(payload.frequency, 'frequency'),
      };
    }
    case 'gpio.analogRead': {
      const pin = assertGpioPin(payload.pin);
      assertEsp32AnalogPin(pin);
      return { pin };
    }
    case 'i2c.begin': {
      const next: Record<string, unknown> = {};
      if (payload.sda !== undefined) {
        const sda = assertGpioPin(payload.sda);
        assertEsp32BusPin(sda, 'I2C SDA');
        next.sda = sda;
      }
      if (payload.scl !== undefined) {
        const scl = assertGpioPin(payload.scl);
        assertEsp32BusPin(scl, 'I2C SCL');
        next.scl = scl;
      }
      if (payload.frequency !== undefined) {
        next.frequency = assertPositiveInt(payload.frequency, 'frequency');
      }
      return next;
    }
    case 'i2c.write':
      return {
        address: assertI2cAddress(payload.address),
        data: assertBusBytes(payload.data, 'data'),
      };
    case 'i2c.read':
      return {
        address: assertI2cAddress(payload.address),
        length: assertBusLength(payload.length),
      };
    case 'i2c.scan':
      assertEmptyPayload(payload, action);
      return {};
    case 'spi.begin': {
      const next: Record<string, unknown> = {};
      if (payload.sck !== undefined) {
        const sck = assertGpioPin(payload.sck);
        assertEsp32BusPin(sck, 'SPI SCK');
        next.sck = sck;
      }
      if (payload.miso !== undefined) {
        const miso = assertGpioPin(payload.miso);
        assertEsp32ReadPin(miso);
        next.miso = miso;
      }
      if (payload.mosi !== undefined) {
        const mosi = assertGpioPin(payload.mosi);
        assertEsp32BusPin(mosi, 'SPI MOSI');
        next.mosi = mosi;
      }
      if (payload.chipSelect !== undefined) {
        const chipSelect = assertGpioPin(payload.chipSelect);
        assertEsp32BusPin(chipSelect, 'SPI chip-select');
        next.chipSelect = chipSelect;
      }
      if (payload.frequency !== undefined) {
        next.frequency = assertPositiveInt(payload.frequency, 'frequency');
      }
      return next;
    }
    case 'spi.transfer': {
      const next: Record<string, unknown> = { data: assertBusBytes(payload.data, 'data') };
      if (payload.chipSelect !== undefined) {
        const chipSelect = assertGpioPin(payload.chipSelect);
        assertEsp32BusPin(chipSelect, 'SPI chip-select');
        next.chipSelect = chipSelect;
      }
      return next;
    }
    default:
      return payload;
  }
}

function assertEmptyPayload(payload: Record<string, unknown>, action: string): void {
  for (const key of Object.keys(payload)) {
    throw new ValidationError(`Unexpected field '${key}' in payload for '${action}'.`);
  }
}

function assertPositiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive integer, received ${String(value)}.`);
  }
  return value;
}

function assertChannel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 15) {
    throw new ValidationError(
      `channel must be an integer from 0 to 15, received ${String(value)}.`,
    );
  }
  return value;
}

function assertDuty(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ValidationError(`duty must be a number from 0 to 1, received ${String(value)}.`);
  }
  return value;
}
