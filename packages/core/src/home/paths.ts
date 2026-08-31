import { homedir } from 'node:os';
import { join } from 'node:path';

export const PINOUT_HOME_ENV = 'PINOUT_HOME';
export const PINOUT_CONFIG_ENV = 'PINOUT_CONFIG';

export function resolvePinoutHome(explicitHome?: string): string {
  if (explicitHome) {
    return explicitHome;
  }
  if (process.env[PINOUT_HOME_ENV]) {
    return process.env[PINOUT_HOME_ENV] as string;
  }
  return join(homedir(), '.pinout');
}

export function resolveDevicesConfigPath(home: string, explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }
  if (process.env[PINOUT_CONFIG_ENV]) {
    return process.env[PINOUT_CONFIG_ENV] as string;
  }
  return join(home, 'devices.json');
}

export function moduleInstallDirectory(home: string, moduleId: string): string {
  return join(home, 'modules', moduleId.replace('/', '--'));
}

export function modulesIndexPath(home: string): string {
  return join(home, 'modules.json');
}

export function pinoutConfigPath(home: string): string {
  return join(home, 'config.json');
}
