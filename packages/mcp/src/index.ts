#!/usr/bin/env node
import { runStdioServer } from './runStdio.js';

export { createDaemonMcpServer } from './createDaemonServer.js';

runStdioServer().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
