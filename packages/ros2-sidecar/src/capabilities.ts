import {
  type CapabilityDescriptor,
  PolicyConstraintViolation,
  type PolicyRule,
} from '@pinout/core';

const coordinateSchema = {
  type: 'number',
  description: 'Meters in the robot coordinate frame.',
} as const;

export const armMoveToPoseCapability: CapabilityDescriptor = {
  name: 'arm.move_to_pose',
  description: 'Move manipulator to a target Cartesian pose via ROS 2 action controller.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['target'],
    properties: {
      target: {
        type: 'object',
        required: ['frame', 'position'],
        additionalProperties: false,
        properties: {
          frame: {
            type: 'string',
            description: 'Target coordinate frame (e.g. base_link, world, tool0).',
          },
          position: {
            type: 'object',
            required: ['x', 'y', 'z'],
            additionalProperties: false,
            properties: {
              x: coordinateSchema,
              y: coordinateSchema,
              z: coordinateSchema,
            },
          },
          orientation: {
            type: 'object',
            additionalProperties: false,
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
              w: { type: 'number' },
            },
          },
        },
      },
      transformAt: {
        description:
          'ISO-8601 string or epoch ms timestamp when the target transform was observed.',
      },
      maxTransformAgeMs: {
        type: 'number',
        description: 'Maximum allowable age of the perception transform in milliseconds.',
      },
      velocityScaling: {
        type: 'number',
        description: 'Optional velocity scaling factor (0.0 to 1.0).',
      },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['success', 'position', 'frame', 'durationMs', 'evidence'],
    properties: {
      success: { type: 'boolean' },
      position: {
        type: 'object',
        required: ['x', 'y', 'z'],
        properties: {
          x: coordinateSchema,
          y: coordinateSchema,
          z: coordinateSchema,
        },
      },
      frame: { type: 'string' },
      durationMs: { type: 'number' },
      commandOverheadMs: { type: 'number' },
      evidence: {
        type: 'object',
        required: ['source', 'at', 'provenance'],
        properties: {
          source: { type: 'string' },
          at: { type: 'string' },
          provenance: { type: 'string' },
        },
      },
      stream: {
        type: 'object',
        properties: {
          streamId: { type: 'string' },
          framesEmitted: { type: 'number' },
          sampleRateHz: { type: 'number' },
        },
      },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Commands arm trajectory execution on the ROS 2 controller.',
  },
};

export const armStopCapability: CapabilityDescriptor = {
  name: 'arm.stop',
  description: 'Independent stop that cancels in-flight trajectory on the ROS 2 controller.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  outputSchema: {
    type: 'object',
    required: ['status', 'stopConfirmed', 'at'],
    properties: {
      status: { type: 'string', enum: ['stopped'] },
      stopConfirmed: { type: 'boolean' },
      at: { type: 'string' },
      activeGoalCancelled: { type: 'boolean' },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Cancels in-flight ROS 2 action and commands immediate controller stop.',
  },
};

export const armReadPoseCapability: CapabilityDescriptor = {
  name: 'arm.read_pose',
  description: 'Read the current confirmed manipulator pose and physical evidence.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  outputSchema: {
    type: 'object',
    required: ['position', 'frame', 'status', 'evidence'],
    properties: {
      position: {
        type: 'object',
        required: ['x', 'y', 'z'],
        properties: {
          x: coordinateSchema,
          y: coordinateSchema,
          z: coordinateSchema,
        },
      },
      frame: { type: 'string' },
      status: { type: 'string' },
      evidence: {
        type: 'object',
        required: ['source', 'at', 'provenance'],
        properties: {
          source: { type: 'string' },
          at: { type: 'string' },
          provenance: { type: 'string' },
        },
      },
    },
  },
  safety: {
    physicalOutput: false,
    reversible: true,
  },
};

export const ros2SidecarCapabilities = [
  armMoveToPoseCapability,
  armStopCapability,
  armReadPoseCapability,
] as const;

export const ros2SidecarCapabilityNames = ros2SidecarCapabilities.map(
  (capability) => capability.name,
);

export const ros2ArmWorkspacePolicy: PolicyRule = {
  kind: 'custom',
  capability: 'arm.move_to_pose',
  evaluate: ({ payload }) => {
    const target = payload.target as
      { position?: { x?: number; y?: number; z?: number } } | undefined;
    if (target?.position) {
      const { x, y, z } = target.position;
      if (typeof x === 'number' && (x < -1.0 || x > 1.0)) {
        throw new PolicyConstraintViolation(
          `Target position X (${x}) is outside workspace bounds [-1.0, 1.0].`,
        );
      }
      if (typeof y === 'number' && (y < -1.0 || y > 1.0)) {
        throw new PolicyConstraintViolation(
          `Target position Y (${y}) is outside workspace bounds [-1.0, 1.0].`,
        );
      }
      if (typeof z === 'number' && (z < 0.0 || z > 1.5)) {
        throw new PolicyConstraintViolation(
          `Target position Z (${z}) is outside workspace bounds [0.0, 1.5].`,
        );
      }
    }
  },
};
