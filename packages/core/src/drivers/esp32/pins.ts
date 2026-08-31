import { ValidationError } from '../../errors.js';

export const esp32FlashPins = [6, 7, 8, 9, 10, 11] as const;
export const esp32InputOnlyPins = [34, 35, 36, 37, 38, 39] as const;
export const esp32Uart0Pins = [1, 3] as const;
export const esp32DefaultLedPin = 2;

export function assertGpioPin(pin: unknown): number {
  if (typeof pin !== 'number' || !Number.isInteger(pin) || pin < 0) {
    throw new ValidationError(`GPIO pin must be a non-negative integer, received ${String(pin)}.`);
  }
  return pin;
}

export function assertGpioValue(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`GPIO value must be a boolean, received ${String(value)}.`);
  }
  return value;
}

export function isEsp32FlashPin(pin: number): boolean {
  return pin >= 6 && pin <= 11;
}

export function isEsp32InputOnlyPin(pin: number): boolean {
  return pin >= 34 && pin <= 39;
}

export function isEsp32Uart0Pin(pin: number): boolean {
  return pin === 1 || pin === 3;
}

export function assertEsp32ReadPin(pin: number): void {
  if (pin > 39 || isEsp32FlashPin(pin) || isEsp32Uart0Pin(pin)) {
    throw new ValidationError(esp32PinMessage(pin, 'read'));
  }
}

export function assertEsp32WritePin(pin: number): void {
  if (pin > 39 || isEsp32FlashPin(pin) || isEsp32InputOnlyPin(pin) || isEsp32Uart0Pin(pin)) {
    throw new ValidationError(esp32PinMessage(pin, 'write'));
  }
}

function esp32PinMessage(pin: number, operation: 'read' | 'write'): string {
  if (isEsp32FlashPin(pin)) {
    return `GPIO ${pin} is wired to SPI flash on ESP32. ${operation} is refused.`;
  }
  if (isEsp32Uart0Pin(pin)) {
    return `GPIO ${pin} is UART0 (USB serial). ${operation} is refused while using this transport.`;
  }
  if (operation === 'write' && isEsp32InputOnlyPin(pin)) {
    return `GPIO ${pin} is input-only on ESP32 and cannot be driven.`;
  }
  return `GPIO ${pin} is not a valid ESP32 pin for ${operation}.`;
}
