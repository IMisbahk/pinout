import { describe, expect, it } from 'vitest';
import { PinoutRuntime, relayModule, registerModule } from '../src/index.js';
import { runtimeToToolDefinitions, classifyToolDanger } from '../src/runtime/toolExport.js';

describe('runtimeToToolDefinitions', () => {
  it('exports protocol-neutral tool definitions per device capability', async () => {
    const runtime = new PinoutRuntime();
    registerModule(relayModule);
    await runtime.registerFromModule(relayModule.id, { id: 'relay-01', simulated: true });

    const tools = runtimeToToolDefinitions(runtime);
    const set = tools.find((tool) => tool.capability === 'relay.set');
    expect(set).toBeDefined();
    expect(set!.name).toBe('relay-01.relay.set');
    expect(set!.deviceId).toBe('relay-01');
    expect(set!.danger).toBe('PHYSICAL_SIDE_EFFECT');
    expect(set!.safety.physicalOutput).toBe(true);
    expect(set!.inputSchema.type).toBe('object');
  });

  it('classifies danger from safety metadata', () => {
    expect(classifyToolDanger({ physicalOutput: true, reversible: false })).toBe('HIGH_RISK');
    expect(classifyToolDanger({ physicalOutput: true, reversible: true })).toBe(
      'PHYSICAL_SIDE_EFFECT',
    );
    expect(classifyToolDanger({ physicalOutput: false, reversible: true })).toBe('READ_ONLY');
  });
});

describe('runtime.invoke with options', () => {
  it('supports dry-run at the runtime level', async () => {
    const runtime = new PinoutRuntime();
    registerModule(relayModule);
    await runtime.registerFromModule(relayModule.id, { id: 'relay-02', simulated: true });

    const plan = await runtime.invoke('relay-02', 'relay.set', { on: true }, { dryRun: true });
    expect(plan).toMatchObject({ dryRun: true, deviceId: 'relay-02', capability: 'relay.set' });
  });
});
