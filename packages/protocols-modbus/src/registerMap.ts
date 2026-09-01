/**
 * Declarative register-map device mapping.
 *
 * A register map turns a generic Modbus client into a named-device surface.
 * Unknown registers NEVER become writable capabilities: writes require an
 * explicit `access: 'write'` entry in the map.
 */
import type { ModbusTcpClient } from './tcpClient.js';
import { ModbusError } from './wire.js';

export type RegisterArea = 'coil' | 'discrete' | 'holding' | 'input';
export type RegisterAccess = 'read' | 'write';

export interface RegisterMapEntry {
  name: string;
  area: RegisterArea;
  address: number;
  access: RegisterAccess;
  /** Data shape: boolean (coil/discrete) or integer register (holding/input). */
  type: 'bool' | 'uint16';
  /** Scaling factor applied on read: `physical = raw * scale + offset`. */
  scale?: number;
  offset?: number;
  unit?: string;
  description?: string;
}

export interface RegisterMapDevice {
  capabilities: Array<{ id: string; access: RegisterAccess; unit?: string }>;
  read(entryName: string): Promise<number | boolean>;
  write(entryName: string, value: number | boolean): Promise<void>;
}

export interface RegisterMapOptions {
  client: ModbusTcpClient;
  map: RegisterMapEntry[];
}

function validateMap(map: RegisterMapEntry[]): void {
  const seen = new Set<string>();
  for (const entry of map) {
    if (seen.has(entry.name)) {
      throw new ModbusError('MODBUS_MAP_DUPLICATE', `Duplicate register map entry '${entry.name}'.`);
    }
    seen.add(entry.name);
    if (entry.access === 'write' && entry.type === 'uint16' && entry.area !== 'holding') {
      throw new ModbusError('MODBUS_MAP_INVALID', `Write entries must use the 'holding' area ('${entry.name}').`);
    }
    if (entry.access === 'write' && entry.type === 'bool' && entry.area !== 'coil') {
      throw new ModbusError('MODBUS_MAP_INVALID', `Writable booleans must use the 'coil' area ('${entry.name}').`);
    }
  }
}

/** Build a named device surface over a Modbus TCP client. */
export function createRegisterMapDevice(options: RegisterMapOptions): RegisterMapDevice {
  validateMap(options.map);
  const byName = new Map(options.map.map((entry) => [entry.name, entry]));

  const capabilities = options.map.map((entry) => ({
    id: `modbus.${entry.name}.${entry.access}`,
    access: entry.access,
    ...(entry.unit !== undefined ? { unit: entry.unit } : {}),
  }));

  return {
    capabilities,

    async read(entryName: string): Promise<number | boolean> {
      const entry = byName.get(entryName);
      if (!entry) {
        throw new ModbusError('MODBUS_MAP_UNKNOWN_ENTRY', `Register map has no entry '${entryName}'.`);
      }
      switch (entry.area) {
        case 'coil': {
          const values = await options.client.readCoils(entry.address, 1);
          return values[0] ?? false;
        }
        case 'discrete': {
          const values = await options.client.readDiscreteInputs(entry.address, 1);
          return values[0] ?? false;
        }
        case 'holding': {
          const raw = (await options.client.readHoldingRegisters(entry.address, 1))[0] ?? 0;
          return applyScaling(entry, raw);
        }
        case 'input': {
          const raw = (await options.client.readInputRegisters(entry.address, 1))[0] ?? 0;
          return applyScaling(entry, raw);
        }
      }
    },

    async write(entryName: string, value: number | boolean): Promise<void> {
      const entry = byName.get(entryName);
      if (!entry) {
        throw new ModbusError('MODBUS_MAP_UNKNOWN_ENTRY', `Register map has no entry '${entryName}'.`);
      }
      if (entry.access !== 'write') {
        throw new ModbusError('MODBUS_MAP_READ_ONLY', `Entry '${entryName}' is read-only; writes require explicit access: 'write' in the map.`);
      }
      if (entry.type === 'bool') {
        await options.client.writeSingleCoil(entry.address, Boolean(value));
        return;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ModbusError('MODBUS_INVALID_VALUE', `Entry '${entryName}' expects a finite number.`);
      }
      // Reverse scaling on write: raw = (physical - offset) / scale.
      const scale = entry.scale ?? 1;
      const offset = entry.offset ?? 0;
      const raw = Math.round((value - offset) / scale);
      if (raw < 0 || raw > 0xffff) {
        throw new ModbusError('MODBUS_INVALID_VALUE', `Scaled value ${raw} exceeds the 16-bit register range.`);
      }
      await options.client.writeSingleRegister(entry.address, raw);
    },
  };
}

function applyScaling(entry: RegisterMapEntry, raw: number): number {
  const scale = entry.scale ?? 1;
  const offset = entry.offset ?? 0;
  return raw * scale + offset;
}
