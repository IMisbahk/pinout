import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHeterogeneousRuntime, loadPinoutConfig } from '@pinout/core';
import { connectPinoutDevice } from './connectDevice.js';
import { createPinoutMcpServer } from './createServer.js';
import { createRuntimeMcpServer } from './createRuntimeServer.js';

export async function runStdioServer(): Promise<void> {
  if (process.env.PINOUT_DEMO === 'heterogeneous') {
    await runHeterogeneousRuntimeServer();
    return;
  }

  const device = await connectPinoutDevice();
  const server = createPinoutMcpServer(device);
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    await server.close().catch(() => undefined);
    await device.close().catch(() => undefined);
  };

  attachShutdown(shutdown);
  await server.connect(transport);
  await shutdown();
}

async function runHeterogeneousRuntimeServer(): Promise<void> {
  const config = loadPinoutConfig();
  const runtime = await createHeterogeneousRuntime({
    useHardwareEsp32: Boolean(config.port),
  });
  const server = createRuntimeMcpServer(runtime);
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    await server.close().catch(() => undefined);
    await runtime.close().catch(() => undefined);
  };

  attachShutdown(shutdown);
  await server.connect(transport);
  await shutdown();
}

function attachShutdown(shutdown: () => Promise<void>): void {
  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
}
