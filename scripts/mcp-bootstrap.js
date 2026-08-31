import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const configPath = process.env.PINOUT_CONFIG ?? join(homedir(), '.pinout', 'devices.json');

if (existsSync(configPath) || process.env.PINOUT_CONFIG) {
  process.env.PINOUT_DEMO = 'heterogeneous';
} else if (!process.env.PINOUT_DEMO) {
  process.env.PINOUT_MOCK = process.env.PINOUT_MOCK ?? '1';
}

await import('../packages/mcp/dist/index.js');
