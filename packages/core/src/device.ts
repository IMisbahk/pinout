import { UnsupportedCapabilityError, ValidationError } from './errors.js';
import { describeCapabilities, toAgentTools } from './capabilities.js';
import {
  assertEsp32ReadPin,
  assertEsp32WritePin,
  assertGpioPin,
  assertGpioValue,
} from './drivers/esp32/pins.js';
import type { Session } from './session.js';
import type { AgentTool, CapabilityDescriptor, DeviceInfo } from './types.js';

export class Device {
  readonly capabilities: CapabilityDescriptor[];
  readonly gpio: Gpio;

  constructor(
    readonly info: DeviceInfo,
    private readonly session: Session,
  ) {
    this.capabilities = describeCapabilities(info.capabilities);
    this.gpio = new Gpio(this);
  }

  supports(action: string): boolean {
    return this.info.capabilities.includes(action);
  }

  async invoke(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (!this.supports(action)) {
      throw new UnsupportedCapabilityError(action);
    }
    const normalized = validateAction(this.info.firmware, action, payload);
    return this.session.request(action, normalized);
  }

  toAgentTools(): AgentTool[] {
    return toAgentTools(this.capabilities);
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}

class Gpio {
  constructor(private readonly device: Device) {}

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
}

function validateAction(
  firmware: string,
  action: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (action !== 'gpio.write' && action !== 'gpio.read') {
    return payload;
  }

  const pin = assertGpioPin(payload.pin);
  if (firmware === 'esp32-bridge') {
    if (action === 'gpio.write') {
      assertEsp32WritePin(pin);
    } else {
      assertEsp32ReadPin(pin);
    }
  }

  if (action === 'gpio.write') {
    return { pin, value: assertGpioValue(payload.value) };
  }
  return { pin };
}
