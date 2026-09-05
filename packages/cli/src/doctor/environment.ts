import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolvePinoutHome } from '@pinout/core';
import type { DoctorCheckResult, DoctorDependencies } from './types.js';

export function checkNodeVersion(deps: DoctorDependencies): DoctorCheckResult {
  const versionString = deps.nodeVersion ?? process.versions.node;
  const major = Number(versionString.split('.')[0]);
  const isCompatible = Number.isInteger(major) && major >= 20;

  if (isCompatible) {
    return {
      stage: 'environment',
      name: 'node-version',
      status: 'pass',
      detail: `v${versionString} (Node.js >= 20 required)`,
    };
  }

  return {
    stage: 'environment',
    name: 'node-version',
    status: 'fail',
    detail: `v${versionString} is below required Node.js 20+`,
    nextStep: 'Upgrade Node.js to >= 20.0.0 (see https://nodejs.org).',
  };
}

export function checkPinoutHome(deps: DoctorDependencies): DoctorCheckResult {
  const homePath = resolvePinoutHome(deps.home);

  if (deps.isHomeWritable) {
    const isWritable = deps.isHomeWritable(homePath);
    if (isWritable) {
      return {
        stage: 'environment',
        name: 'pinout-home',
        status: 'pass',
        detail: `${homePath} (writable)`,
      };
    }
    return {
      stage: 'environment',
      name: 'pinout-home',
      status: 'fail',
      detail: `${homePath} is not writable`,
      nextStep: `Ensure write permissions for '${homePath}' or set PINOUT_HOME to a writable path.`,
    };
  }

  try {
    if (!existsSync(homePath)) {
      const parentDir = dirname(homePath);
      if (existsSync(parentDir)) {
        accessSync(parentDir, constants.W_OK);
      }
      mkdirSync(homePath, { recursive: true });
    }
    accessSync(homePath, constants.W_OK);
    return {
      stage: 'environment',
      name: 'pinout-home',
      status: 'pass',
      detail: `${homePath} (writable)`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      stage: 'environment',
      name: 'pinout-home',
      status: 'fail',
      detail: `${homePath} is not writable (${errorMessage})`,
      nextStep: `Ensure write permissions for '${homePath}' or set PINOUT_HOME to a writable path.`,
    };
  }
}

export function checkEnvironmentVariables(deps: DoctorDependencies): DoctorCheckResult {
  const env = deps.env ?? process.env;

  const daemonUrl =
    env.PINOUT_DAEMON_URL !== undefined
      ? `${env.PINOUT_DAEMON_URL} (PINOUT_DAEMON_URL)`
      : env.PINOUT_URL !== undefined
        ? `${env.PINOUT_URL} (PINOUT_URL)`
        : 'http://127.0.0.1:8787 (default)';

  const tokenInfo =
    env.PINOUT_TOKEN !== undefined && env.PINOUT_TOKEN.length > 0
      ? 'set (bearer auth enabled)'
      : 'not set (unauthenticated loopback)';

  const owner =
    env.PINOUT_OWNER !== undefined ? `${env.PINOUT_OWNER} (from env)` : 'cli-lease (default)';

  const port = env.PINOUT_PORT !== undefined ? env.PINOUT_PORT : 'not set';

  const baud =
    env.PINOUT_BAUD !== undefined ? `${env.PINOUT_BAUD} (from env)` : '115200 (default)';

  const timeout =
    env.PINOUT_TIMEOUT !== undefined ? `${env.PINOUT_TIMEOUT}ms (from env)` : '5000ms (default)';

  const details = [
    `daemonUrl: ${daemonUrl}`,
    `token: ${tokenInfo}`,
    `owner: ${owner}`,
    `port: ${port}`,
    `baud: ${baud}`,
    `timeout: ${timeout}`,
  ].join(', ');

  return {
    stage: 'environment',
    name: 'env-vars',
    status: 'pass',
    detail: details,
    meta: {
      daemonUrl,
      hasToken: env.PINOUT_TOKEN !== undefined && env.PINOUT_TOKEN.length > 0,
      owner,
      port: env.PINOUT_PORT,
      baud,
      timeout,
    },
  };
}
