import { ValidationError } from '../../errors.js';
import { esp32DefaultLedPin } from './pins.js';

export const esp32DevKitPinMap = {
  led: esp32DefaultLedPin,
} as const;

export type Esp32DevKitPinName = keyof typeof esp32DevKitPinMap;

export function resolveEsp32DevKitPin(name: string): number {
  if (name in esp32DevKitPinMap) {
    return esp32DevKitPinMap[name as Esp32DevKitPinName];
  }
  throw new ValidationError(`Unknown ESP32 DevKit pin name '${name}'.`);
}
