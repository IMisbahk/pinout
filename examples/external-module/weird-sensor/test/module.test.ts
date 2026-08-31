import { describe, expect, it } from 'vitest';
import moduleDefinition from '../src/index.js';

describe('weird-sensor module', () => {
  it('declares expected capabilities', () => {
    expect(moduleDefinition.capabilityNames).toEqual([
      'temperature.read',
      'humidity.read',
      'status.read',
    ]);
  });

  it('reads temperature from simulated backend', async () => {
    const backend = moduleDefinition.createSimulatedBackend!({});
    const result = await backend.invoke('temperature.read', {});
    expect(result.temperature).toBeTypeOf('number');
    await backend.close();
  });
});
