export {
  validateCandidate,
  mergeCandidates,
  runDiscovery,
  formatCandidatesTable,
  candidateId,
  CandidateValidationError,
} from './core.js';
export type {
  DiscoveredCandidate,
  DiscoveredEndpoint,
  EndpointKind,
  Evidence,
  IdentityGuess,
  DiscoveryOptions,
  DiscoveryPlugin,
  DiscoveryRun,
} from './core.js';
export {
  serialDiscoveryPlugin,
  usbDiscoveryPlugin,
  mdnsDiscoveryPlugin,
  networkProbePlugin,
  encodeMdnsQuery,
  parseMdnsResponse,
} from './plugins.js';
