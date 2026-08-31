export interface PinGroup {
  label: string;
  pins: number[];
  note: string;
}

export const esp32PinGroups: PinGroup[] = [
  {
    label: 'Default LED',
    pins: [2],
    note: 'Common onboard LED pin on ESP32 DevKit boards.',
  },
  {
    label: 'SPI flash (forbidden)',
    pins: [6, 7, 8, 9, 10, 11],
    note: 'Connected to SPI flash. Read/write can crash firmware.',
  },
  {
    label: 'UART0 (forbidden while on serial)',
    pins: [1, 3],
    note: 'USB serial console. Refused while using this transport.',
  },
  {
    label: 'Boot strap (forbidden)',
    pins: [12],
    note: 'GPIO 12 high at reset can prevent boot. Refused by SDK and firmware.',
  },
  {
    label: 'Input-only',
    pins: [34, 35, 36, 37, 38, 39],
    note: 'Cannot be driven as outputs.',
  },
  {
    label: 'General GPIO',
    pins: [0, 2, 4, 5, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
    note: 'Usual safe digital I/O range (subject to board wiring).',
  },
];
