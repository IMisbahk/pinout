import { confidenceBand, type HardwareInterfaceIR } from '../types/ir.js';

export function formatGenerationPlan(ir: HardwareInterfaceIR): string {
  const lines: string[] = [];
  const deviceName =
    [ir.device.vendor, ir.device.model].filter(Boolean).join(' ') || 'Unknown device';
  lines.push(`Device:\n${deviceName}`);
  if (ir.device.deviceClass) {
    lines.push(`\nSuggested class:\n${ir.device.deviceClass}`);
  }

  if (ir.interfaces.length > 0) {
    lines.push('\nInterfaces:');
    for (const iface of ir.interfaces) {
      lines.push(`  ${iface.kind}${iface.port ? ` (port ${iface.port})` : ''}`);
    }
  }

  lines.push('\nCapabilities:');
  for (const capability of ir.capabilities) {
    const band = confidenceBand(capability.confidence).toUpperCase();
    lines.push(`${band.padEnd(6)} ${capability.id}`);
  }

  if (ir.safety.length > 0) {
    lines.push('\nSafety:');
    for (const constraint of ir.safety) {
      const band = confidenceBand(constraint.confidence).toUpperCase();
      const detail =
        constraint.type === 'range'
          ? `${constraint.capability} ${constraint.minimum ?? '?'}–${constraint.maximum ?? '?'}°C`
          : constraint.type === 'precondition'
            ? `${constraint.capability} requires ${constraint.field} == ${String(constraint.equals)}`
            : `${constraint.capability} (candidate — review required)`;
      const review = constraint.requiresHumanReview ? ' [REVIEW]' : '';
      lines.push(`${band.padEnd(6)} ${detail}${review}`);
    }
  }

  if (ir.uncertainties.length > 0) {
    lines.push('\nUnknown:');
    for (const uncertainty of ir.uncertainties) {
      lines.push(`? ${uncertainty.message}`);
    }
  }

  return lines.join('\n');
}

export function formatGenerationPlanJson(ir: HardwareInterfaceIR): Record<string, unknown> {
  return {
    device: ir.device,
    interfaces: ir.interfaces,
    capabilities: ir.capabilities.map((cap) => ({
      id: cap.id,
      confidence: cap.confidence,
      band: confidenceBand(cap.confidence),
    })),
    safety: ir.safety,
    uncertainties: ir.uncertainties,
  };
}
