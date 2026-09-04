import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHeterogeneousRuntime, esp32Module, loadPinoutConfig, PinoutRuntime } from '@pinout/core';
import { createMcpTransport } from './connectDevice.js';
import { createRuntimeMcpServer } from './createRuntimeServer.js';

export async function runStdioServer(): Promise<void> {
  if (process.env.PINOUT_DEMO === 'heterogeneous') {
    await runHeterogeneousRuntimeServer();
    return;
  }

  const runtime = new PinoutRuntime();
  await runtime.registerModuleDevice(esp32Module, {
    id: 'esp32-01',
    transport: await createMcpTransport(),
  });
  const server = createRuntimeMcpServer(runtime, { owner: 'mcp-stdio' });
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

async function runHeterogeneousRuntimeServer(): Promise<void> {
  const config = loadPinoutConfig();
  const runtime = await createHeterogeneousRuntime({
    useHardwareEsp32: Boolean(config.port),
  });
  const server = createRuntimeMcpServer(runtime, { owner: 'mcp-stdio' });
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
