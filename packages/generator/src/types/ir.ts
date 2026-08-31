export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface EvidenceReference {
  sourceId: string;
  path: string;
  lines?: { start: number; end: number };
  excerpt?: string;
}

export interface Uncertainty {
  id: string;
  message: string;
  confidence?: number;
  evidence?: EvidenceReference[];
  severity: 'info' | 'warning' | 'critical';
}

export interface CandidateArgument {
  name: string;
  type: 'number' | 'integer' | 'string' | 'boolean' | 'object';
  unit?: string;
  description?: string;
  required?: boolean;
}

export interface CandidateCapability {
  id: string;
  description?: string;
  vendorNames?: string[];
  arguments?: Record<string, CandidateArgument>;
  output?: Record<string, CandidateArgument>;
  confidence: number;
  evidence: EvidenceReference[];
  implementationStatus: 'implemented' | 'skeleton' | 'unknown';
}

export interface CandidateStateField {
  name: string;
  type: string;
  description?: string;
  evidence?: EvidenceReference[];
}

export interface CandidateEvent {
  id: string;
  description?: string;
  confidence: number;
  evidence: EvidenceReference[];
}

export interface CandidateSafetyConstraint {
  type: 'range' | 'precondition' | 'candidate';
  capability: string;
  argument?: string;
  field?: string;
  minimum?: number;
  maximum?: number;
  equals?: string | number | boolean;
  message?: string;
  confidence: number;
  evidence: EvidenceReference[];
  requiresHumanReview: boolean;
  documented: boolean;
}

export interface HardwareInterface {
  kind: 'tcp' | 'serial' | 'http' | 'sdk' | 'unknown';
  description?: string;
  host?: string;
  port?: number;
  baud?: number;
  commands?: string[];
  evidence: EvidenceReference[];
  confidence: number;
}

export interface HardwareDeviceInference {
  vendor?: string;
  model?: string;
  deviceClass?: string;
  description?: string;
  confidence: number;
  evidence: EvidenceReference[];
}

export interface HardwareInterfaceIR {
  device: HardwareDeviceInference;
  interfaces: HardwareInterface[];
  capabilities: CandidateCapability[];
  state?: CandidateStateField[];
  events?: CandidateEvent[];
  safety: CandidateSafetyConstraint[];
  evidence: EvidenceReference[];
  uncertainties: Uncertainty[];
}

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.9) {
    return 'high';
  }
  if (confidence >= 0.7) {
    return 'medium';
  }
  return 'low';
}
