import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { connectPinoutDevice } from './connectDevice.js';
import { createPinoutMcpServer } from './createServer.js';

export async function runStdioServer(): Promise<void> {
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

  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  await server.connect(transport);
  await shutdown();
}
