import { coffeeMachineModule, PinoutRuntime } from '@pinout/core';
import { startDaemon } from '@pinout/daemon';

const runtime = new PinoutRuntime();
await runtime.registerModuleDevice(coffeeMachineModule, {
  id: 'coffee-sim',
  simulated: true,
  backendOptions: { brewDurationMs: 20 },
});
const daemon = await startDaemon(runtime, { port: 0 });
const base = `http://127.0.0.1:${daemon.port}`;
const json = async (path: string, body?: Record<string, unknown>) => {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
};

try {
  const lease = await json('/v1/leases', {
    owner: 'coffee-demo',
    scope: { kind: 'device', deviceId: 'coffee-sim' },
    mode: 'exclusive',
  });
  const request = {
    capability: 'brew.start',
    args: { shots: 1 },
    owner: 'coffee-demo',
    idempotencyKey: 'demo-brew-1',
    waitFor: 'result',
  };
  const preview = await json('/v1/devices/coffee-sim/invoke', { ...request, dryRun: true });
  const first = await json('/v1/devices/coffee-sim/invoke', request);
  const retry = await json('/v1/devices/coffee-sim/invoke', request);
  await json('/v1/halt', { reason: 'demo safe-state proof', actor: 'coffee-demo' });
  await runtime.waitForSafeState();
  process.stdout.write(
    `${JSON.stringify({ lease, preview, first, retry, safety: await json('/v1/safety') }, null, 2)}\n`,
  );
} finally {
  await daemon.close();
}
