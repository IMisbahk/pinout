export type PolicyRule =
  NumericRangePolicy | StateEqualsPolicy | WorkspaceBoundsPolicy | CustomPolicy;

export interface PolicyContext {
  deviceId: string;
  capability: string;
  payload: Record<string, unknown>;
  operationalState: Record<string, unknown>;
}

export interface NumericRangePolicy {
  kind: 'numericRange';
  capability: string;
  field: string;
  min: number;
  max: number;
  message?: string;
}

export interface StateEqualsPolicy {
  kind: 'stateEquals';
  capability: string;
  field: string;
  equals: string | number | boolean;
  /** Maximum acceptable age of the observed state, in milliseconds. */
  maxStateAgeMs?: number;
  message?: string;
}

export interface WorkspaceBoundsPolicy {
  kind: 'workspaceBounds';
  capability: string;
  fields: {
    x: { min: number; max: number };
    y: { min: number; max: number };
    z: { min: number; max: number };
  };
  message?: string;
}

export interface CustomPolicy {
  kind: 'custom';
  capability: string;
  evaluate: (context: PolicyContext) => void;
}
