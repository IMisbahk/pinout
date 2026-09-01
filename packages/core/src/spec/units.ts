/**
 * Deterministic unit conversions.
 *
 * Conversions here must be exact and lossless within float precision. If a
 * conversion is ambiguous (e.g. temperature between relative scales without
 * context), the conversion throws rather than guessing — unknown is better
 * than hallucinated.
 */
import type { Unit } from './types.js';

/** Canonical base units: length m, angle rad, mass kg, temperature K, current A. */
const CANONICAL: Partial<Record<Unit, Unit>> = {
  mm: 'm',
  cm: 'm',
  km: 'm',
  deg: 'rad',
  rev: 'rad',
  'mm/s': 'm/s',
  'deg/s': 'rad/s',
  rpm: 'rad/s',
  'g': 'kg',
  C: 'K',
  F: 'K',
  mA: 'A',
};

export function toCanonical(value: number, unit: Unit): { value: number; unit: Unit } {
  switch (unit) {
    case 'mm': return { value: value / 1000, unit: 'm' };
    case 'cm': return { value: value / 100, unit: 'm' };
    case 'km': return { value: value * 1000, unit: 'm' };
    case 'mm/s': return { value: value / 1000, unit: 'm/s' };
    case 'deg': return { value: (value * Math.PI) / 180, unit: 'rad' };
    case 'deg/s': return { value: (value * Math.PI) / 180, unit: 'rad/s' };
    case 'rev': return { value: value * 2 * Math.PI, unit: 'rad' };
    case 'rpm': return { value: (value * 2 * Math.PI) / 60, unit: 'rad/s' };
    case 'g': return { value: value / 1000, unit: 'kg' };
    case 'mA': return { value: value / 1000, unit: 'A' };
    default:
      if (CANONICAL[unit]) return { value, unit: CANONICAL[unit] as Unit };
      return { value, unit };
  }
}

const LINEAR: Record<string, { factor: number }> = {
  // length
  'mm|m': { factor: 1000 },
  'cm|m': { factor: 100 },
  'km|m': { factor: 1 / 1000 },
  // angle
  'deg|rad': { factor: 180 / Math.PI },
  'rev|rad': { factor: 1 / (2 * Math.PI) },
  // velocity
  'mm/s|m/s': { factor: 1000 },
  'deg/s|rad/s': { factor: 180 / Math.PI },
  'rpm|rad/s': { factor: 60 / (2 * Math.PI) },
  // mass
  'g|kg': { factor: 1000 },
  // current
  'mA|A': { factor: 1000 },
  // pressure
  'kPa|Pa': { factor: 1 / 1000 },
  'bar|Pa': { factor: 1 / 100000 },
  'psi|Pa': { factor: 1 / 6894.757293168361 },
};

function celsiusToKelvin(value: number): number {
  return value + 273.15;
}

function kelvinToCelsius(value: number): number {
  return value - 273.15;
}

function fahrenheitToKelvin(value: number): number {
  return ((value - 32) * 5) / 9 + 273.15;
}

function kelvinToFahrenheit(value: number): number {
  return ((value - 273.15) * 9) / 5 + 32;
}

/**
 * Convert `value` from `from` to `to`. Throws when no deterministic conversion
 * exists — callers must surface that as an error, not a guess.
 */
export function convert(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;

  const key = `${from}|${to}`;
  const linear = LINEAR[key];
  if (linear) return value / linear.factor;
  const reverse = LINEAR[`${to}|${from}`];
  if (reverse) return value * reverse.factor;

  // Temperature, via Kelvin as the pivot.
  if (from === 'C' && to === 'K') return celsiusToKelvin(value);
  if (from === 'K' && to === 'C') return kelvinToCelsius(value);
  if (from === 'F' && to === 'K') return fahrenheitToKelvin(value);
  if (from === 'K' && to === 'F') return kelvinToFahrenheit(value);
  if (from === 'C' && to === 'F') return kelvinToFahrenheit(celsiusToKelvin(value));
  if (from === 'F' && to === 'C') return kelvinToCelsius(fahrenheitToKelvin(value));

  // Percent of a binary or bounded quantity is not convertible without a range.
  throw new Error(`No deterministic unit conversion from '${from}' to '${to}'.`);
}

export function isKnownUnit(unit: string): unit is Unit {
  const known: readonly Unit[] = [
    'm', 'mm', 'cm', 'km', 'rad', 'deg', 'rev', 'm/s', 'mm/s', 'rad/s', 'deg/s', 'rpm',
    'm/s2', 'rad/s2', 'N', 'N.m', 'kg', 'g', 'C', 'F', 'K', 'V', 'mV', 'A', 'mA', 'W',
    'Pa', 'kPa', 'bar', 'psi', 'Hz', 'percent', 'lux', 'counts', 'bool', 'string',
  ];
  return known.includes(unit as Unit);
}
