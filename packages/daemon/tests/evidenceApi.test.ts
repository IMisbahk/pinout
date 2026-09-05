import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PinoutRuntime,
  relayModule,
  registerModule,
  DeviceInstance,
  type CapabilityDescriptor,
  type DeviceBackend,
  type DeviceIdentity,
} from '@pinout/core';
import { startDaemon, type RunningDaemon } from '../src/start.js';

const gpioWriteCap: CapabilityDescriptor = {
  name: 'gpio.write',
  description: 'Write GPIO pin level.',
  inputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: {
      pin: { type: 'number' },
      value: { type: 'boolean' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: {
      pin: { type: 'number' },
      value: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: true, reversible: true },
};

const gpioReadCap: CapabilityDescriptor = {
  name: 'gpio.read',
  description: 'Read GPIO pin level.',
  inputSchema: {
    type: 'object',
    required: ['pin'],
    properties: {
      pin: { type: 'number' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: {
      pin: { type: 'number' },
      value: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

function createSimulatedGpioDevice(id: string): DeviceInstance {
  const identity: DeviceIdentity = {
    id,
    moduleId: 'test/gpio-module',
    deviceClass: 'microcontroller',
  };

  let pinValue = false;

  const backend: DeviceBackend = {
    kind: 'simulated',
    invoke: async (action, payload) => {
      if (action === 'gpio.write') {
        pinValue = Boolean(payload.value);
        return { pin: payload.pin, value: payload.value };
      }
      if (action === 'gpio.read') {
        return { pin: payload.pin, value: pinValue };
      }
      return {};
    },
    close: async () => undefined,
    subscribe: () => () => undefined,
    getOperationalState: () => ({ pin2: pinValue }),
  };

  return new DeviceInstance({
    identity,
    backend,
    capabilities: [gpioWriteCap, gpioReadCap],
    policies: [],
    simulated: true,
    transportKinds: ['simulated'],
    getOperationalState: () => backend.getOperationalState?.() ?? {},
  });
}

describe('Daemon HTTP Evidence-Qualified State API', () => {
  let daemon: RunningDaemon;
  let base: string;
  let journalDir: string;
  let runtime: PinoutRuntime;

  beforeAll(async () => {
    runtime = new PinoutRuntime();
    registerModule(relayModule);
    await runtime.registerFromModule(relayModule.id, { id: 'relay-ev-01', simulated: true });
    const gpioDevice = createSimulatedGpioDevice('gpio-ev-01');
    await runtime.register(gpioDevice);

    journalDir = await mkdtemp(join(tmpdir(), 'pinoutd-evidence-test-'));
    daemon = await startDaemon(runtime, {
      port: 0,
      journalPath: join(journalDir, 'journal.jsonl'),
      requireLeases: false,
    });
    base = `http://127.0.0.1:${daemon.port}`;
  });

  afterAll(async () => {
    await daemon?.close();
    await rm(journalDir, { recursive: true, force: true });
  });

  it('includes stateEvidence in GET /v1/devices list summaries', async () => {
    const res = await fetch(`${base}/v1/devices`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      devices: Array<{ id: string; stateEvidence?: Record<string, unknown> }>;
    };
    const gpio = body.devices.find((d) => d.id === 'gpio-ev-01');
    expect(gpio).toBeDefined();
    expect(gpio?.stateEvidence).toBeDefined();
  });

  it('includes stateEvidence in GET /v1/devices/:id device detail', async () => {
    const res = await fetch(`${base}/v1/devices/gpio-ev-01`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      operationalState: Record<string, unknown>;
      stateEvidence: Record<string, unknown>;
    };
    expect(body.id).toBe('gpio-ev-01');
    expect(body.operationalState).toBeDefined();
    expect(body.stateEvidence).toBeDefined();
  });

  it('includes stateEvidence in GET /v1/devices/:id/state alongside legacy state and health', async () => {
    const res = await fetch(`${base}/v1/devices/gpio-ev-01/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deviceId: string;
      state: Record<string, unknown>;
      stateEvidence: Record<string, unknown>;
      health: { lifecycle: string };
    };
    expect(body.deviceId).toBe('gpio-ev-01');
    expect(body.state).toBeDefined();
    expect(body.health?.lifecycle).toBe('ready');
    expect(body.stateEvidence).toBeDefined();
  });

  it('sets commanded/acknowledged but leaves observed.source === none on write command', async () => {
    const invokeRes = await fetch(`${base}/v1/devices/gpio-ev-01/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capability: 'gpio.write',
        args: { pin: 2, value: true },
        waitFor: 'result',
      }),
    });
    expect(invokeRes.status).toBe(200);

    const stateRes = await fetch(`${base}/v1/devices/gpio-ev-01/state`);
    const body = (await stateRes.json()) as {
      stateEvidence: Record<
        string,
        {
          commanded: { value: unknown; source: string; at: string | null };
          acknowledged: { value: unknown; source: string; at: string | null };
          observed: { value: unknown; source: string; at: string | null };
          freshnessMs: number | null;
          stale: boolean;
          provenance: string;
        }
      >;
    };

    const pinEvidence = body.stateEvidence['gpio.2'];
    expect(pinEvidence).toBeDefined();
    expect(pinEvidence!.commanded.value).toBe(true);
    expect(pinEvidence!.commanded.source).toBe('commanded');
    expect(pinEvidence!.commanded.at).toBeTruthy();

    expect(pinEvidence!.acknowledged.value).toBe(true);
    expect(pinEvidence!.acknowledged.source).toBe('acknowledged');
    expect(pinEvidence!.acknowledged.at).toBeTruthy();

    // Physical evidence is NOT inferred from a write
    expect(pinEvidence!.observed.value).toBeNull();
    expect(pinEvidence!.observed.source).toBe('none');
    expect(pinEvidence!.observed.at).toBeNull();
    expect(pinEvidence!.freshnessMs).toBeNull();
  });

  it('populates observed with timestamp and freshness on independent read', async () => {
    const readRes = await fetch(`${base}/v1/devices/gpio-ev-01/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capability: 'gpio.read',
        args: { pin: 2 },
        waitFor: 'result',
      }),
    });
    expect(readRes.status).toBe(200);
    const readBody = (await readRes.json()) as { result: { pin: number; value: boolean } };
    expect(readBody.result.value).toBe(true);

    const stateRes = await fetch(`${base}/v1/devices/gpio-ev-01/state`);
    const body = (await stateRes.json()) as {
      stateEvidence: Record<
        string,
        {
          commanded: { value: unknown };
          acknowledged: { value: unknown };
          observed: { value: unknown; source: string; at: string | null };
          freshnessMs: number | null;
          stale: boolean;
          provenance: string;
        }
      >;
    };

    const pinEvidence = body.stateEvidence['gpio.2'];
    expect(pinEvidence).toBeDefined();
    expect(pinEvidence!.observed.value).toBe(true);
    expect(pinEvidence!.observed.source).toBe('simulated');
    expect(pinEvidence!.observed.at).toBeTruthy();
    expect(typeof pinEvidence!.freshnessMs).toBe('number');
    expect(pinEvidence!.stale).toBe(false);
  });

  it('forwards stateEvidence in SSE event stream envelopes', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/v1/events`, { signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Trigger an invocation that emits an event
    void fetch(`${base}/v1/devices/relay-ev-01/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capability: 'relay.set',
        args: { on: true },
        waitFor: 'result',
      }),
    });

    let eventData: Record<string, unknown> | undefined;
    const deadline = Date.now() + 4000;
    let buffer = '';

    while (Date.now() < deadline) {
      const timeout = new Promise<{ value?: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ done: true }), 150),
      );
      const result = await Promise.race([reader.read(), timeout]);
      if (result.done) break;
      buffer += decoder.decode(result.value!);

      const lines = buffer.split('\n\n');
      buffer = lines.pop() ?? '';

      for (const block of lines) {
        if (block.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(block.slice(6)) as {
              kind?: string;
              data?: {
                event?: string;
                stateEvidence?: Record<string, unknown>;
              };
            };
            if (parsed.kind === 'runtime.event' && parsed.data?.stateEvidence) {
              eventData = parsed.data;
              break;
            }
          } catch {
            // ignore non-json
          }
        }
      }
      if (eventData) break;
    }

    controller.abort();
    expect(eventData).toBeDefined();
    expect(eventData?.stateEvidence).toBeDefined();
  });
});
