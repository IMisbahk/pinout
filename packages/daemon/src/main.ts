#!/usr/bin/env node
/**
 * pinoutd CLI entry point.
 *
 * Usage: pinoutd [--port 8787] [--host 127.0.0.1] [--token <t>] [--journal <path>]
 *
 * Binds loopback only unless --host and --token are both provided explicitly.
 */
import process from 'node:process';
import { createRuntimeFromConfig, PINOUT_VERSION } from '@pinout/core';
import { startDaemon } from './start.js';
import { DEFAULT_DAEMON_PORT } from './httpServer.js';

interface ParsedArgs {
  port: number;
  host: string | undefined;
  token: string | undefined;
  journalPath: string | undefined;
  demo: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { port: DEFAULT_DAEMON_PORT, host: undefined, token: undefined, journalPath: undefined, demo: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--port':
        args.port = Number.parseInt(next ?? '', 10);
        i += 1;
        break;
      case '--host':
        args.host = next;
        i += 1;
        break;
      case '--token':
        args.token = next;
        i += 1;
        break;
      case '--journal':
        args.journalPath = next;
        i += 1;
        break;
      case '--demo':
        args.demo = true;
        break;
      default:
        break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { runtime } = await createRuntimeFromConfig({
    includeDemoDefaults: args.demo,
    continueOnError: true,
  });
  const daemon = await startDaemon(runtime, {
    ...(args.host ? { host: args.host } : {}),
    port: args.port,
    ...(args.token ? { token: args.token } : {}),
    ...(args.journalPath ? { journalPath: args.journalPath } : {}),
  });

  const where = daemon.socketPath ?? `http://${daemon.host}:${daemon.port}`;
  process.stdout.write(`pinoutd v${PINOUT_VERSION} listening on ${where} (loopback only)\n`);

  const shutdown = async (): Promise<void> => {
    await daemon.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`pinoutd: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
