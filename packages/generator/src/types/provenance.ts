export type GeneratorCandidateStatus =
  'GENERATED' | 'CONFORMANCE_PASSED' | 'SIMULATION_TESTED' | 'HUMAN_REVIEWED' | 'HARDWARE_TESTED';

export interface GenerationProvenance {
  pinoutVersion: string;
  generatorVersion: string;
  provider: string;
  model: string;
  timestamp: string;
  sourceHashes: Record<string, string>;
  status: GeneratorCandidateStatus;
}
