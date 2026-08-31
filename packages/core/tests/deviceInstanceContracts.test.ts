import { describe, expect, it } from 'vitest';
import {
  DeviceInstance,
  DisconnectedError,
  AgentToolNameCollisionError,
  PinoutRuntime,
  ProtocolError,
  runtimeToAgentTools,
  type CapabilityDescriptor,
  type DeviceBackend,
} from '@pinout/core';

const statusCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  },
  safety: { physicalOutput: false, reversible: true },
};

describe('DeviceInstance capability contracts', () => {
  it('keeps lifecycle busy until every concurrent invocation settles', async () => {
    const pending = [deferred<Record<string, unknown>>(), deferred<Record<string, unknown>>()];
    let invocation = 0;
    const device = createDevice({
      invoke: async () => pending[invocation++]!.promise,
    });

    const first = device.invoke('status.read');
    const second = device.invoke('status.read');
    expect(device.getHealth().lifecycle).toBe('busy');

    pending[0]!.resolve({ ok: true });
    await first;
    expect(device.getHealth().lifecycle).toBe('busy');

    pending[1]!.resolve({ ok: true });
    await second;
    expect(device.getHealth().lifecycle).toBe('ready');
    await device.close();
  });

  it('rejects malformed backend output at the capability boundary', async () => {
    const device = createDevice({ invoke: async () => ({ ok: 'yes' }) });
    await expect(device.invoke('status.read')).rejects.toBeInstanceOf(ProtocolError);
    await device.close();
  });

  it('rejects new work after close begins', async () => {
    const device = createDevice({ invoke: async () => ({ ok: true }) });
    await device.close();
    await expect(device.invoke('status.read')).rejects.toBeInstanceOf(DisconnectedError);
  });

  it('fails closed when two capabilities normalize to the same MCP tool name', async () => {
    const runtime = new PinoutRuntime();
    const collidingCapability: CapabilityDescriptor = {
      ...statusCapability,
      name: 'status_read',
    };
    const device = createDevice({ invoke: async () => ({ ok: true }) }, [
      statusCapability,
      collidingCapability,
    ]);
    await runtime.register(device);
    expect(() => runtimeToAgentTools(runtime)).toThrow(AgentToolNameCollisionError);
    await runtime.close();
  });
});

function createDevice(
  overrides: Pick<DeviceBackend, 'invoke'>,
  capabilities: CapabilityDescriptor[] = [statusCapability],
): DeviceInstance {
  const backend: DeviceBackend = {
    kind: 'simulated',
    invoke: overrides.invoke,
    close: async () => undefined,
    subscribe: () => () => undefined,
  };
  return new DeviceInstance({
    identity: { id: 'contract-test', moduleId: 'test/contract', deviceClass: 'test' },
    backend,
    capabilities,
    policies: [],
    simulated: true,
    transportKinds: ['simulated'],
    getOperationalState: () => ({}),
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
