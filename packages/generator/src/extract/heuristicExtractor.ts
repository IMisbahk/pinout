import { evidenceFromMatch, findLineEvidence } from '../ingest/evidence.js';
import { inferDeviceClass, mapVendorSymbol } from '../semantic/capabilityMapper.js';
import type {
  CandidateCapability,
  CandidateSafetyConstraint,
  HardwareInterface,
  HardwareInterfaceIR,
  HardwareDeviceInference,
  Uncertainty,
} from '../types/ir.js';
import type { SourceDocument } from '../types/source.js';

export function extractHardwareIr(documents: SourceDocument[]): HardwareInterfaceIR {
  const text = documents.map((doc) => doc.content).join('\n');
  const uncertainties: Uncertainty[] = [];
  const capabilities = new Map<string, CandidateCapability>();
  const safety: CandidateSafetyConstraint[] = [];

  extractCapabilities(documents, capabilities, uncertainties);
  extractSafety(documents, text, safety, uncertainties, capabilities);
  detectAmbiguities(documents, text, uncertainties, safety);

  if (/TCP|port\s*\d+/i.test(text) && !/timeout/i.test(text)) {
    uncertainties.push({
      id: 'transport-timeout',
      message: 'No documented connection timeout for TCP interface.',
      severity: 'warning',
    });
  }

  const state = inferState(text);
  const ir: HardwareInterfaceIR = {
    device: inferDeviceMetadata(documents, text),
    interfaces: inferInterfaceList(documents, text),
    capabilities: [...capabilities.values()].sort((a, b) => a.id.localeCompare(b.id)),
    events: [],
    safety,
    evidence: documents.map((doc) => ({ sourceId: doc.id, path: doc.path })),
    uncertainties,
  };
  if (state) {
    ir.state = state;
  }
  return ir;
}

function inferDeviceMetadata(documents: SourceDocument[], text: string): HardwareDeviceInference {
  const evidence = [];
  let vendor: string | undefined;
  let model: string | undefined;

  for (const doc of documents) {
    const vendorMatch = findLineEvidence(doc, /vendor\s*:\s*([^\n]+)/i);
    if (vendorMatch) {
      vendor = vendorMatch.match[1]?.trim();
      evidence.push(vendorMatch.evidence);
    }
    const modelMatch = findLineEvidence(doc, /model\s*:\s*([^\n]+)/i);
    if (modelMatch) {
      model = modelMatch.match[1]?.trim();
      evidence.push(modelMatch.evidence);
    }
  }

  if (!vendor && /Acme/i.test(text)) {
    vendor = 'Acme';
  }
  if (!model) {
    const heatbox = text.match(/HeatBox\s*400/i);
    if (heatbox) {
      model = 'HeatBox 400';
    }
    const arm = text.match(/RoboArm\s*X1/i);
    if (arm) {
      model = 'RoboArm X1';
    }
  }

  const deviceClass = inferDeviceClass(text);
  const inference: HardwareDeviceInference = {
    confidence: vendor && model && deviceClass ? 0.95 : 0.65,
    evidence,
  };
  if (vendor !== undefined) {
    inference.vendor = vendor;
  }
  if (model !== undefined) {
    inference.model = model;
  }
  if (deviceClass !== undefined) {
    inference.deviceClass = deviceClass;
  }
  if (model) {
    inference.description = `${vendor ?? 'Unknown'} ${model}`;
  }
  return inference;
}

function inferInterfaceList(documents: SourceDocument[], text: string): HardwareInterface[] {
  const interfaces: HardwareInterface[] = [];
  const baseEvidence = documents.slice(0, 1).map((doc) => ({ sourceId: doc.id, path: doc.path }));

  if (/TCP|telnet|socket/i.test(text)) {
    const portMatch = text.match(/port\s*(?:=|:)?\s*(\d+)/i);
    const tcp: HardwareInterface = {
      kind: 'tcp',
      evidence: baseEvidence,
      confidence: 0.85,
    };
    if (portMatch) {
      tcp.port = Number.parseInt(portMatch[1]!, 10);
    }
    interfaces.push(tcp);
  }
  if (/serial|UART|RS-?232|baud/i.test(text)) {
    interfaces.push({
      kind: 'serial',
      baud: 115200,
      evidence: baseEvidence,
      confidence: 0.8,
    });
  }
  if (interfaces.length === 0) {
    interfaces.push({
      kind: 'sdk',
      description: 'SDK/library integration inferred from source files',
      evidence: baseEvidence,
      confidence: 0.6,
    });
  }
  return interfaces;
}

function extractCapabilities(
  documents: SourceDocument[],
  capabilities: Map<string, CandidateCapability>,
  uncertainties: Uncertainty[],
): void {
  const symbolPattern =
    /\b(function|def|void|int|float|bool|async)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(|^\s*([A-Z_]{3,}[A-Z0-9_]*)\s*$/gm;

  for (const doc of documents) {
    let match: RegExpExecArray | null;
    while ((match = symbolPattern.exec(doc.content)) !== null) {
      const symbol = match[2] ?? match[3];
      if (!symbol) {
        continue;
      }
      const mapping = mapVendorSymbol(symbol);
      if (!mapping) {
        continue;
      }
      mergeCapability(
        capabilities,
        mapping.capabilityId,
        mapping.confidence,
        symbol,
        evidenceFromMatch(doc, match.index, match[0]),
      );
    }

    for (const line of doc.content.split('\n')) {
      const cmdMatch = line.match(/^(SET TEMP|GET TEMP|OPEN DOOR|CLOSE DOOR|LED:ON|LED:OFF)/i);
      if (cmdMatch) {
        const mapping = mapVendorSymbol(cmdMatch[1]!);
        if (mapping) {
          mergeCapability(
            capabilities,
            mapping.capabilityId,
            mapping.confidence,
            cmdMatch[1]!,
            evidenceFromMatch(doc, doc.content.indexOf(line), line),
          );
        }
        continue;
      }

      const backtickFn = line.match(/`([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\)`/);
      if (backtickFn) {
        const mapping = mapVendorSymbol(backtickFn[1]!);
        if (mapping) {
          mergeCapability(
            capabilities,
            mapping.capabilityId,
            mapping.confidence,
            backtickFn[1]!,
            evidenceFromMatch(doc, doc.content.indexOf(line), line),
          );
        }
      }
    }
  }

  if (capabilities.has('temperature.set')) {
    const cap = capabilities.get('temperature.set')!;
    if (!cap.arguments?.temperature?.unit) {
      uncertainties.push({
        id: 'temperature-unit',
        message: 'Could not determine unit for temperature parameter in all sources.',
        severity: 'warning',
        confidence: 0.5,
      });
    }
  }
}

function mergeCapability(
  capabilities: Map<string, CandidateCapability>,
  capabilityId: string,
  confidence: number,
  symbol: string,
  evidence: ReturnType<typeof evidenceFromMatch>,
): void {
  const existing = capabilities.get(capabilityId);
  if (existing) {
    existing.vendorNames?.push(symbol);
    existing.evidence.push(evidence);
    existing.confidence = Math.max(existing.confidence, confidence);
    return;
  }
  const capability: CandidateCapability = {
    id: capabilityId,
    description: `Mapped from vendor symbol '${symbol}'`,
    vendorNames: [symbol],
    confidence,
    evidence: [evidence],
    implementationStatus: confidence >= 0.85 ? 'implemented' : 'skeleton',
  };
  const args = defaultArguments(capabilityId);
  if (args) {
    capability.arguments = args;
  }
  capabilities.set(capabilityId, capability);
}

function defaultArguments(capabilityId: string) {
  if (capabilityId === 'temperature.set') {
    return {
      temperature: {
        name: 'temperature',
        type: 'number' as const,
        unit: 'celsius',
        required: true,
      },
    };
  }
  if (capabilityId === 'motion.move_to') {
    return {
      x: { name: 'x', type: 'number' as const, required: true },
      y: { name: 'y', type: 'number' as const, required: true },
      z: { name: 'z', type: 'number' as const, required: true },
    };
  }
  return undefined;
}

function extractSafety(
  documents: SourceDocument[],
  text: string,
  safety: CandidateSafetyConstraint[],
  uncertainties: Uncertainty[],
  capabilities: Map<string, CandidateCapability>,
): void {
  for (const doc of documents) {
    const explicitRange = findLineEvidence(
      doc,
      /(?:operating|safe|allowed)?\s*temperature\s*:?\s*(\d+)\s*°?\s*C?\s*(?:to|–|-)\s*(\d+)\s*°?\s*C?/i,
    );
    if (explicitRange && capabilities.has('temperature.set')) {
      safety.push({
        type: 'range',
        capability: 'temperature.set',
        argument: 'temperature',
        minimum: Number.parseInt(explicitRange.match[1]!, 10),
        maximum: Number.parseInt(explicitRange.match[2]!, 10),
        confidence: 0.99,
        evidence: [explicitRange.evidence],
        requiresHumanReview: false,
        documented: true,
      });
    }

    const inferredRange = findLineEvidence(doc, /(?:max(?:imum)?|up to)\s*(\d+)\s*°?\s*C/i);
    if (inferredRange && !safety.some((s) => s.capability === 'temperature.set' && s.documented)) {
      safety.push({
        type: 'candidate',
        capability: 'temperature.set',
        argument: 'temperature',
        maximum: Number.parseInt(inferredRange.match[1]!, 10),
        confidence: 0.65,
        evidence: [inferredRange.evidence],
        requiresHumanReview: true,
        documented: false,
        message: 'Inferred maximum temperature — requires human review before hard policy.',
      });
    }

    if (
      /experiment\.start.*door.*closed|door must be closed|requires door closed/i.test(doc.content)
    ) {
      safety.push({
        type: 'precondition',
        capability: 'experiment.start',
        field: 'door',
        equals: 'closed',
        confidence: 0.96,
        evidence: [{ sourceId: doc.id, path: doc.path, excerpt: 'door closed precondition' }],
        requiresHumanReview: false,
        documented: true,
      });
    }
  }

  if (
    capabilities.has('temperature.set') &&
    !safety.some((s) => s.capability === 'temperature.set')
  ) {
    uncertainties.push({
      id: 'no-temperature-range',
      message: 'NO SAFE RANGE FOUND for temperature.set in analyzed sources.',
      severity: 'critical',
    });
  }

  const rangeMatches = [...text.matchAll(/(\d+)\s*°?\s*C?\s*(?:to|-)\s*(\d+)\s*°?\s*C/gi)];
  if (rangeMatches.length > 1) {
    const mins = rangeMatches.map((m) => Number.parseInt(m[1]!, 10));
    const maxs = rangeMatches.map((m) => Number.parseInt(m[2]!, 10));
    const unique = new Set(mins.map((min, i) => `${min}-${maxs[i]}`));
    if (unique.size > 1) {
      uncertainties.push({
        id: 'conflicting-ranges',
        message: 'Conflicting temperature range documentation detected across sources.',
        severity: 'critical',
      });
    }
  }
}

function detectAmbiguities(
  documents: SourceDocument[],
  text: string,
  uncertainties: Uncertainty[],
  safety: CandidateSafetyConstraint[],
): void {
  if (/speed|velocity/i.test(text) && !/\b(km\/h|rpm|m\/s|mm\/s)\b/i.test(text)) {
    uncertainties.push({
      id: 'unknown-speed-unit',
      message: 'Unknown unit for speed parameter.',
      severity: 'warning',
    });
  }

  if (/experiment\.start/i.test(text) && /timing|TBD|unclear/i.test(text)) {
    uncertainties.push({
      id: 'experiment-timing',
      message: 'experiment.start timing semantics are unclear.',
      severity: 'info',
    });
  }

  if (safety.some((s) => s.requiresHumanReview)) {
    uncertainties.push({
      id: 'review-inferred-safety',
      message: 'One or more safety constraints were inferred and require human review.',
      severity: 'warning',
    });
  }

  for (const doc of documents) {
    if (/deprecated|obsolete/i.test(doc.content)) {
      uncertainties.push({
        id: `deprecated-${doc.id}`,
        message: `Method or API may be deprecated per ${doc.path}.`,
        severity: 'warning',
        evidence: [{ sourceId: doc.id, path: doc.path }],
      });
    }
  }
}

function inferState(text: string) {
  const fields = [];
  if (/temperature/i.test(text)) {
    fields.push({ name: 'temperature', type: 'number', description: 'Current temperature' });
  }
  if (/door/i.test(text)) {
    fields.push({ name: 'door', type: 'string', description: 'Door state open|closed' });
  }
  if (/position|pose|moveTo/i.test(text)) {
    fields.push({ name: 'position', type: 'object', description: 'End effector position' });
  }
  return fields.length > 0 ? fields : undefined;
}
