import type { CapabilityDescriptor } from './types.js';
import { esp32BridgeCapabilities } from './drivers/esp32/bridge.js';
import { chamberCapabilities } from './modules/chamber/capabilities.js';
import { dcMotorCapabilities } from './modules/dcMotor/capabilities.js';
import { robotArmCapabilities } from './modules/robotArm/capabilities.js';
import { servoCapabilities } from './modules/servo/capabilities.js';
import { stepperCapabilities } from './modules/stepper/capabilities.js';

const gpioPinSchema = {
  type: 'integer',
  description: 'GPIO pin number. Valid ranges are device-specific.',
  minimum: 0,
} as const;

export const gpioWriteCapability: CapabilityDescriptor = {
  name: 'gpio.write',
  description: 'Drive a GPIO pin high or low.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pin', 'value'],
    properties: {
      pin: gpioPinSchema,
      value: { type: 'boolean', description: 'true for high, false for low.' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: { pin: gpioPinSchema, value: { type: 'boolean' } },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes:
      'Changes the electrical state of a pin. Invalid pins can crash firmware or damage hardware.',
  },
};

export const gpioReadCapability: CapabilityDescriptor = {
  name: 'gpio.read',
  description: 'Read the current level of a GPIO pin.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pin'],
    properties: { pin: gpioPinSchema },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: { pin: gpioPinSchema, value: { type: 'boolean' } },
  },
  safety: {
    physicalOutput: false,
    reversible: true,
    notes: 'Read-only. Output pins return the driven level.',
  },
};

export const gpioModeCapability: CapabilityDescriptor = {
  name: 'gpio.mode',
  description: 'Configure a GPIO pin as input, output, pullup, or pulldown.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pin', 'mode'],
    properties: {
      pin: gpioPinSchema,
      mode: { type: 'string', enum: ['input', 'output', 'pullup', 'pulldown'] },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'mode'],
    properties: {
      pin: gpioPinSchema,
      mode: { type: 'string', enum: ['input', 'output', 'pullup', 'pulldown'] },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Changes pin electrical configuration.',
  },
};

export const gpioToggleCapability: CapabilityDescriptor = {
  name: 'gpio.toggle',
  description: 'Flip the driven level of an output GPIO pin.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pin'],
    properties: { pin: gpioPinSchema },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: { pin: gpioPinSchema, value: { type: 'boolean' } },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const gpioPulseCapability: CapabilityDescriptor = {
  name: 'gpio.pulse',
  description: 'Drive a pin to a level for a duration in milliseconds.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pin', 'value', 'durationMs'],
    properties: {
      pin: gpioPinSchema,
      value: { type: 'boolean', description: 'Level to drive during the pulse.' },
      durationMs: { type: 'integer', minimum: 1, description: 'Duration in milliseconds.' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'value', 'durationMs'],
    properties: {
      pin: gpioPinSchema,
      value: { type: 'boolean' },
      durationMs: { type: 'integer', minimum: 1 },
      previousValue: { type: 'boolean' },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Blocks the device for the pulse duration on hardware.',
  },
};

export const gpioPwmCapability: CapabilityDescriptor = {
  name: 'gpio.pwm',
  description: 'Configure LEDC PWM on a GPIO pin.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pin', 'duty'],
    properties: {
      channel: { type: 'integer', minimum: 0, maximum: 15 },
      pin: gpioPinSchema,
      duty: { type: 'number', minimum: 0, maximum: 1 },
      frequency: { type: 'integer', minimum: 1 },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'duty'],
    properties: {
      channel: { type: 'integer' },
      pin: gpioPinSchema,
      duty: { type: 'number' },
      frequency: { type: 'integer' },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'PWM output. Set duty to 0 to stop. Duty 1.0 is full scale.',
  },
};

export const gpioAnalogReadCapability: CapabilityDescriptor = {
  name: 'gpio.analogRead',
  description: 'Read an ADC sample from an analog-capable GPIO pin.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pin'],
    properties: { pin: gpioPinSchema },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: {
      pin: gpioPinSchema,
      value: { type: 'integer', minimum: 0, maximum: 4095 },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const gpioWatchCapability: CapabilityDescriptor = {
  name: 'gpio.watch',
  description: 'Subscribe to gpio.changed events for a pin.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pin'],
    properties: { pin: gpioPinSchema },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'watching'],
    properties: { pin: gpioPinSchema, watching: { type: 'boolean' } },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const gpioUnwatchCapability: CapabilityDescriptor = {
  name: 'gpio.unwatch',
  description: 'Stop gpio.changed events for a pin.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pin'],
    properties: { pin: gpioPinSchema },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'watching'],
    properties: { pin: gpioPinSchema, watching: { type: 'boolean' } },
  },
  safety: { physicalOutput: false, reversible: true },
};

const busByteSchema = {
  type: 'integer',
  minimum: 0,
  maximum: 255,
  description: 'Byte value 0–255.',
} as const;

const busDataSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 32,
  items: busByteSchema,
  description: 'Payload bytes. Limited to 32 bytes by the protocol line size.',
} as const;

export const i2cBeginCapability: CapabilityDescriptor = {
  name: 'i2c.begin',
  description: 'Initialize the ESP32 I2C bus (defaults: SDA 21, SCL 22, 100 kHz).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      sda: gpioPinSchema,
      scl: gpioPinSchema,
      frequency: { type: 'integer', minimum: 1, description: 'Bus frequency in Hz.' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['sda', 'scl', 'frequency'],
    properties: {
      sda: gpioPinSchema,
      scl: gpioPinSchema,
      frequency: { type: 'integer' },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Configures I2C pins. Do not share these GPIOs with other outputs.',
  },
};

export const i2cWriteCapability: CapabilityDescriptor = {
  name: 'i2c.write',
  description: 'Write bytes to an I2C device address.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['address', 'data'],
    properties: {
      address: { type: 'integer', minimum: 0, maximum: 127 },
      data: busDataSchema,
    },
  },
  outputSchema: {
    type: 'object',
    required: ['address', 'bytesWritten'],
    properties: {
      address: { type: 'integer' },
      bytesWritten: { type: 'integer' },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Writes to a shared I2C bus. A NACK is returned as BUS_ERROR.',
  },
};

export const i2cReadCapability: CapabilityDescriptor = {
  name: 'i2c.read',
  description: 'Read bytes from an I2C device address.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['address', 'length'],
    properties: {
      address: { type: 'integer', minimum: 0, maximum: 127 },
      length: { type: 'integer', minimum: 1, maximum: 32 },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['address', 'data'],
    properties: {
      address: { type: 'integer' },
      data: busDataSchema,
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const i2cScanCapability: CapabilityDescriptor = {
  name: 'i2c.scan',
  description: 'Scan I2C addresses 1–127 and return devices that acknowledge.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['addresses'],
    properties: {
      addresses: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 127 } },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const spiBeginCapability: CapabilityDescriptor = {
  name: 'spi.begin',
  description: 'Initialize the ESP32 SPI bus (defaults: SCK 18, MISO 19, MOSI 23, CS 5).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      sck: gpioPinSchema,
      miso: gpioPinSchema,
      mosi: gpioPinSchema,
      chipSelect: gpioPinSchema,
      frequency: { type: 'integer', minimum: 1 },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['sck', 'miso', 'mosi', 'chipSelect', 'frequency'],
    properties: {
      sck: gpioPinSchema,
      miso: gpioPinSchema,
      mosi: gpioPinSchema,
      chipSelect: gpioPinSchema,
      frequency: { type: 'integer' },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Configures SPI pins. GPIO 6–11 remain reserved for flash.',
  },
};

export const spiTransferCapability: CapabilityDescriptor = {
  name: 'spi.transfer',
  description: 'Full-duplex SPI transfer of 1–32 bytes.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['data'],
    properties: {
      chipSelect: gpioPinSchema,
      data: busDataSchema,
    },
  },
  outputSchema: {
    type: 'object',
    required: ['data'],
    properties: { data: busDataSchema, chipSelect: gpioPinSchema },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Drives MOSI and chip-select. Response bytes are device-specific.',
  },
};

export const sysHelloCapability: CapabilityDescriptor = {
  name: 'sys.hello',
  description: 'Handshake with the device and return firmware identity plus supported actions.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['firmware', 'version', 'protocol', 'capabilities'],
    properties: {
      firmware: { type: 'string' },
      version: { type: 'string' },
      protocol: { type: 'integer' },
      capabilities: { type: 'array', items: { type: 'string' } },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const sysPingCapability: CapabilityDescriptor = {
  name: 'sys.ping',
  description: 'Round-trip liveness check with the device.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['pong'],
    properties: { pong: { type: 'boolean' } },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const sysInfoCapability: CapabilityDescriptor = {
  name: 'sys.info',
  description: 'Return runtime diagnostics such as uptime and free heap.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['uptimeMs'],
    properties: {
      uptimeMs: { type: 'integer', minimum: 0 },
      freeHeap: { type: 'integer', minimum: 0 },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

const catalog: Record<string, CapabilityDescriptor> = {
  [sysHelloCapability.name]: sysHelloCapability,
  [sysPingCapability.name]: sysPingCapability,
  [sysInfoCapability.name]: sysInfoCapability,
  [gpioModeCapability.name]: gpioModeCapability,
  [gpioWriteCapability.name]: gpioWriteCapability,
  [gpioReadCapability.name]: gpioReadCapability,
  [gpioToggleCapability.name]: gpioToggleCapability,
  [gpioPulseCapability.name]: gpioPulseCapability,
  [gpioPwmCapability.name]: gpioPwmCapability,
  [gpioAnalogReadCapability.name]: gpioAnalogReadCapability,
  [gpioWatchCapability.name]: gpioWatchCapability,
  [gpioUnwatchCapability.name]: gpioUnwatchCapability,
  [i2cBeginCapability.name]: i2cBeginCapability,
  [i2cWriteCapability.name]: i2cWriteCapability,
  [i2cReadCapability.name]: i2cReadCapability,
  [i2cScanCapability.name]: i2cScanCapability,
  [spiBeginCapability.name]: spiBeginCapability,
  [spiTransferCapability.name]: spiTransferCapability,
};

for (const capability of [
  ...robotArmCapabilities,
  ...chamberCapabilities,
  ...dcMotorCapabilities,
  ...servoCapabilities,
  ...stepperCapabilities,
]) {
  catalog[capability.name] = capability;
}

export const capabilityCatalog = catalog;

export const firstPartyCapabilities = [...esp32BridgeCapabilities];

export function describeCapability(name: string): CapabilityDescriptor {
  return (
    catalog[name] ?? {
      name,
      description: `Device-reported action '${name}'.`,
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      safety: {
        physicalOutput: true,
        reversible: false,
        notes: 'Unknown action. Treat as potentially unsafe until documented.',
      },
    }
  );
}

export function describeCapabilities(names: string[]): CapabilityDescriptor[] {
  return names.map(describeCapability);
}

export function toAgentTools(capabilities: CapabilityDescriptor[]) {
  return capabilities.map((capability) => ({
    name: capability.name,
    description: capability.description,
    inputSchema: capability.inputSchema,
    outputSchema: capability.outputSchema,
    annotations: capability.safety,
  }));
}
