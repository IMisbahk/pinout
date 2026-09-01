import type { DaemonConfig } from './httpServer.js';
import { DaemonContext, DaemonHttpServer } from './httpServer.js';
import type { PinoutRuntime } from '@pinout/core';

export interface RunningDaemon {
  host: string;
  port: number;
  socketPath?: string;
  context: DaemonContext;
  server: DaemonHttpServer;
  close(): Promise<void>;
}

/**
 * Start a daemon around an existing runtime. This is the programmatic entry
 * point used by tests, the CLI (`pinout daemon start`), and the `pinoutd` bin.
 */
export async function startDaemon(runtime: PinoutRuntime, config: DaemonConfig = {}): Promise<RunningDaemon> {
  const context = new DaemonContext(runtime, config);
  const server = new DaemonHttpServer(context);
  const address = await server.listen(config);

  return {
    ...address,
    context,
    server,
    close: async () => {
      await server.close();
      await runtime.close();
    },
  };
}
