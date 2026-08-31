import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { connect, createHeterogeneousRuntime, simulatedEsp32 } from '@pinout/core';
import { describe, expect, it } from 'vitest';
import { createPinoutMcpServer } from '../src/createServer.js';
import { createRuntimeMcpServer } from '../src/createRuntimeServer.js';

describe('@pinout/mcp server', () => {
  it('lists device capabilities as MCP tools', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    const server = createPinoutMcpServer(device);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'pinout-mcp-test', version: '0.0.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain('gpio.write');
      expect(names).toContain('gpio.read');
      expect(names).toContain('sys.hello');

      const writeTool = tools.find((tool) => tool.name === 'gpio.write');
      expect(writeTool?.inputSchema).toMatchObject({
        required: ['pin', 'value'],
      });
    } finally {
      await client.close();
      await server.close();
      await device.close();
    }
  });

  it('invokes gpio.write through tools/call', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    const server = createPinoutMcpServer(device);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'pinout-mcp-test', version: '0.0.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const writeResult = await client.callTool({
        name: 'gpio.write',
        arguments: { pin: 2, value: true },
      });
      expect(writeResult.isError).not.toBe(true);
      expect(writeResult.structuredContent).toEqual({ pin: 2, value: true });

      const readResult = await client.callTool({
        name: 'gpio.read',
        arguments: { pin: 2 },
      });
      expect(readResult.isError).not.toBe(true);
      expect(readResult.structuredContent).toEqual({ pin: 2, value: true });
    } finally {
      await client.close();
      await server.close();
      await device.close();
    }
  });

  it('returns tool errors for invalid pins without crashing', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    const server = createPinoutMcpServer(device);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'pinout-mcp-test', version: '0.0.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: 'gpio.write',
        arguments: { pin: 34, value: true },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.type).toBe('text');
      if (result.content[0]?.type === 'text') {
        expect(result.content[0].text).toMatch(/input-only|cannot be driven/i);
      }
    } finally {
      await client.close();
      await server.close();
      await device.close();
    }
  });
});

describe('@pinout/mcp heterogeneous runtime', () => {
  it('lists tools from all registered devices with unique names', async () => {
    const runtime = await createHeterogeneousRuntime({ motionDelayMs: 0 });
    const server = createRuntimeMcpServer(runtime);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'pinout-mcp-runtime-test', version: '0.0.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain('esp32_01__gpio_write');
      expect(names).toContain('arm_sim_01__motion_home');
      expect(names).toContain('chamber_sim_01__temperature_set');
      expect(new Set(names).size).toBe(names.length);
    } finally {
      await client.close();
      await server.close();
      await runtime.close();
    }
  });

  it('routes tool calls to the correct device and propagates policy failures', async () => {
    const runtime = await createHeterogeneousRuntime({ motionDelayMs: 0 });
    const server = createRuntimeMcpServer(runtime);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'pinout-mcp-runtime-test', version: '0.0.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const home = await client.callTool({
        name: 'arm_sim_01__motion_home',
        arguments: {},
      });
      expect(home.isError).not.toBe(true);

      const denied = await client.callTool({
        name: 'chamber_sim_01__temperature_set',
        arguments: { value: 200 },
      });
      expect(denied.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
      await runtime.close();
    }
  });
});
