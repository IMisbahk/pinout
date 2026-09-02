import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadBoardDescriptors,
  pinRole,
  validateBoardDescriptor,
} from '../src/boards/descriptors.js';

const boardsDir = join(process.cwd(), 'firmware', 'boards');
const loaded = loadBoardDescriptors(boardsDir);

describe('board descriptors', () => {
  it('loads the committed descriptors without errors', () => {
    expect(loaded.errors).toEqual([]);
    const ids = loaded.boards.map((board) => board.boardId);
    expect(ids).toContain('esp32-devkit-v1');
    expect(ids).toContain('esp32-s3-devkitc-1');
    expect(ids).toContain('esp32-c3-supermini');
    expect(ids).toContain('raspberry-pi-pico');
    expect(ids).toContain('arduino-uno');
  });

  it('covers the esp32 family variants as data, not code', () => {
    const families = new Set(loaded.boards.map((board) => board.family));
    expect(families.has('esp32')).toBe(true);
    expect(families.has('esp32-s3')).toBe(true);
    expect(families.has('esp32-c3')).toBe(true);
  });

  it('reserved pins never overlap usable pins (flash/strap safety)', () => {
    for (const board of loaded.boards) {
      const usable = new Set(board.gpioPins);
      for (const reserved of board.reservedPins) {
        expect(usable.has(reserved), `${board.boardId} pin ${reserved}`).toBe(false);
      }
    }
  });

  it('esp32 classic reserves the flash pins 6-11', () => {
    const esp32 = loaded.boards.find((board) => board.boardId === 'esp32-devkit-v1')!;
    expect(esp32.reservedPins).toEqual(expect.arrayContaining([6, 7, 8, 9, 10, 11]));
    expect(pinRole(esp32, 6)).toBe('reserved');
    expect(pinRole(esp32, 2)).toBe('usable');
    expect(pinRole(esp32, 36)).toBe('input-only'); // safest role wins: no output
    expect(pinRole(esp32, 34)).toBe('input-only');
    // An unknown pin is never actuable.
    expect(pinRole(esp32, 99)).toBe('unknown');
  });

  it('rejects descriptors with overlapping reserved/usable pins', () => {
    expect(() =>
      validateBoardDescriptor({
        schemaVersion: '1',
        boardId: 'bad-board',
        family: 'esp32',
        mcu: 'x',
        gpioPins: [2, 6],
        reservedPins: [6],
        voltage: { logic: 3.3 },
        support: 'PLANNED',
      }),
    ).toThrowError(/never guessed/);
  });

  it('rejects descriptors with out-of-range pin roles', () => {
    expect(() =>
      validateBoardDescriptor({
        schemaVersion: '1',
        boardId: 'bad-adc',
        family: 'esp32',
        mcu: 'x',
        gpioPins: [2],
        reservedPins: [],
        adcPins: [99],
        voltage: { logic: 3.3 },
        support: 'PLANNED',
      }),
    ).toThrowError(/not a usable GPIO/);
  });

  it('rejects unknown schema versions and families', () => {
    expect(() =>
      validateBoardDescriptor({ schemaVersion: '9', boardId: 'x', family: 'esp32', mcu: 'x', gpioPins: [2], reservedPins: [], voltage: { logic: 3.3 }, support: 'PLANNED' }),
    ).toThrowError(/schemaVersion/);
    expect(() =>
      validateBoardDescriptor({ schemaVersion: '1', boardId: 'x', family: 'toaster', mcu: 'x', gpioPins: [2], reservedPins: [], voltage: { logic: 3.3 }, support: 'PLANNED' }),
    ).toThrowError(/family/);
  });
});
