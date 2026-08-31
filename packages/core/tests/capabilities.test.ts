import { describe, expect, it } from 'vitest';
import {
  capabilityCatalog,
  describeCapability,
  firstPartyCapabilities,
  gpioReadCapability,
  gpioWriteCapability,
  sysHelloCapability,
  sysInfoCapability,
  sysPingCapability,
} from '@pinout/core';

describe('capability catalog', () => {
  it('documents every first-party action with full schemas', () => {
    for (const name of firstPartyCapabilities) {
      const descriptor = describeCapability(name);
      expect(descriptor.name).toBe(name);
      expect(descriptor.inputSchema.type).toBe('object');
      expect(descriptor.description).not.toMatch(/^Device-reported action/);
    }
  });

  it('includes sys diagnostics actions in the catalog', () => {
    for (const capability of [sysHelloCapability, sysPingCapability, sysInfoCapability]) {
      expect(capabilityCatalog[capability.name]).toBe(capability);
    }
  });

  it('keeps catalog keys aligned with exported GPIO and sys descriptors', () => {
    expect(capabilityCatalog[gpioWriteCapability.name]).toBe(gpioWriteCapability);
    expect(capabilityCatalog[gpioReadCapability.name]).toBe(gpioReadCapability);
  });
});

describe('sys action validation hooks', () => {
  it('documents empty payloads for diagnostics actions', () => {
    for (const capability of [sysPingCapability, sysInfoCapability, sysHelloCapability]) {
      expect(capability.inputSchema.additionalProperties).toBe(false);
      expect(capability.inputSchema.required ?? []).toEqual([]);
    }
  });
});
