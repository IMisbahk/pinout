import type { CapabilityDescriptor } from '../../types.js';

const coordinateSchema = {
  type: 'number',
  description: 'Meters in the robot workspace.',
} as const;

export const motionHomeCapability: CapabilityDescriptor = {
  name: 'motion.home',
  description: 'Return the manipulator to the home pose.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['homed', 'position'],
    properties: {
      homed: { type: 'boolean' },
      position: {
        type: 'object',
        properties: { x: coordinateSchema, y: coordinateSchema, z: coordinateSchema },
      },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Moves the arm through physical space.',
  },
};

export const motionMoveToCapability: CapabilityDescriptor = {
  name: 'motion.move_to',
  description: 'Move the end effector to a workspace coordinate.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y', 'z'],
    properties: {
      x: coordinateSchema,
      y: coordinateSchema,
      z: coordinateSchema,
    },
  },
  outputSchema: {
    type: 'object',
    required: ['position'],
    properties: {
      position: {
        type: 'object',
        properties: { x: coordinateSchema, y: coordinateSchema, z: coordinateSchema },
      },
    },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const motionStopCapability: CapabilityDescriptor = {
  name: 'motion.stop',
  description: 'Stop any in-progress motion immediately.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status'],
    properties: { status: { type: 'string', enum: ['stopped'] } },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const gripperOpenCapability: CapabilityDescriptor = {
  name: 'gripper.open',
  description: 'Open the gripper.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['gripper'],
    properties: { gripper: { type: 'string', enum: ['open'] } },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const gripperCloseCapability: CapabilityDescriptor = {
  name: 'gripper.close',
  description: 'Close the gripper.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['gripper'],
    properties: { gripper: { type: 'string', enum: ['closed'] } },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const poseReadCapability: CapabilityDescriptor = {
  name: 'pose.read',
  description: 'Read the current end-effector pose.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['position', 'gripper', 'homed'],
    properties: {
      position: {
        type: 'object',
        properties: { x: coordinateSchema, y: coordinateSchema, z: coordinateSchema },
      },
      gripper: { type: 'string', enum: ['open', 'closed'] },
      homed: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const robotStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read manipulator operational status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'position', 'gripper', 'homed'],
    properties: {
      status: { type: 'string', enum: ['ready', 'busy', 'faulted', 'stopped'] },
      position: {
        type: 'object',
        properties: { x: coordinateSchema, y: coordinateSchema, z: coordinateSchema },
      },
      gripper: { type: 'string', enum: ['open', 'closed'] },
      homed: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const robotArmCapabilities = [
  motionHomeCapability,
  motionMoveToCapability,
  motionStopCapability,
  gripperOpenCapability,
  gripperCloseCapability,
  poseReadCapability,
  robotStatusReadCapability,
] as const;

export const robotArmCapabilityNames = robotArmCapabilities.map((capability) => capability.name);

export const robotArmWorkspacePolicy = {
  kind: 'workspaceBounds' as const,
  capability: 'motion.move_to',
  fields: {
    x: { min: -1, max: 1 },
    y: { min: -1, max: 1 },
    z: { min: 0, max: 1.5 },
  },
  message: 'Target position is outside the robot workspace.',
};
