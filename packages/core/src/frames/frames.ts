/**
 * Rigid-body frame math (spec v1).
 *
 * Quaternions are [x, y, z, w] with unit-length normalization on entry.
 *
 * Transform convention: a Transform from → to carries the POSE OF THE
 * `from`-FRAME ORIGIN EXPRESSED IN `to` COORDINATES (translation + rotation).
 * `applyTransform` maps a point from `from` into `to` via p' = R·p + t.
 *
 * Composing or applying transforms whose frames do not chain is an error —
 * frame confusion must fail loudly, never silently.
 */
import type {
  CoordinateFrame,
  FrameReference,
  Pose,
  Quaternion,
  Transform,
  Vector3,
} from '../spec/types.js';

export function vector3(x: number, y: number, z: number): Vector3 {
  return { x, y, z };
}

export function quaternion(x: number, y: number, z: number, w: number): Quaternion {
  const length = Math.hypot(x, y, z, w);
  if (!Number.isFinite(length) || length === 0) {
    throw new Error('Quaternion must be non-zero and finite.');
  }
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

export function quaternionFromAxisAngle(axis: Vector3, radians: number): Quaternion {
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (length === 0) throw new Error('Rotation axis must be non-zero.');
  const half = radians / 2;
  const s = Math.sin(half) / length;
  return quaternion(axis.x * s, axis.y * s, axis.z * s, Math.cos(half));
}

export function pose(position: Vector3, orientation: Quaternion): Pose {
  return { position, orientation };
}

export function frameReference(frame: CoordinateFrame, referencePose: Pose): FrameReference {
  return { frame, pose: referencePose };
}

export function makeTransform(
  from: CoordinateFrame,
  to: CoordinateFrame,
  translation: Vector3,
  rotation: Quaternion,
): Transform {
  return { from, to, translation, rotation, at: Date.now() };
}

export function quaternionMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return quaternion(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  );
}

export function quaternionConjugate(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Rotate a vector by a unit quaternion (Rodrigues form; preserves magnitude). */
export function rotateVector(q: Quaternion, v: Vector3): Vector3 {
  const cross = (a: Vector3, b: Vector3): Vector3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const qv = vector3(q.x, q.y, q.z);
  const t = cross(qv, v);
  const t2 = cross(qv, t);
  return {
    x: v.x + 2 * (q.w * t.x + t2.x),
    y: v.y + 2 * (q.w * t.y + t2.y),
    z: v.z + 2 * (q.w * t.z + t2.z),
  };
}

export function applyTransform(transform: Transform, reference: FrameReference): FrameReference {
  if (reference.frame !== transform.from) {
    throw new Error(
      `FRAME_MISMATCH: pose is in frame '${reference.frame}' but the transform maps '${transform.from}' → '${transform.to}'. Frames are never silently mixed.`,
    );
  }
  const rotated = rotateVector(transform.rotation, reference.pose.position);
  const position = vector3(
    rotated.x + transform.translation.x,
    rotated.y + transform.translation.y,
    rotated.z + transform.translation.z,
  );
  const orientation = quaternionMultiply(transform.rotation, reference.pose.orientation);
  return frameReference(transform.to, pose(position, orientation));
}

/** Compose two transforms: (a: A→B) ∘ (b: B→C) = A→C. */
export function composeTransforms(first: Transform, second: Transform): Transform {
  if (first.to !== second.from) {
    throw new Error(
      `FRAME_MISMATCH: cannot compose '${first.from}→${first.to}' with '${second.from}→${second.to}'.`,
    );
  }
  const rotatedTranslation = rotateVector(first.rotation, second.translation);
  const translation = vector3(
    first.translation.x + rotatedTranslation.x,
    first.translation.y + rotatedTranslation.y,
    first.translation.z + rotatedTranslation.z,
  );
  return makeTransform(
    first.from,
    second.to,
    translation,
    quaternionMultiply(first.rotation, second.rotation),
  );
}

/** Invert a transform: A→B becomes B→A. */
export function invertTransform(transform: Transform): Transform {
  const inverseRotation = quaternionConjugate(transform.rotation);
  const rotated = rotateVector(inverseRotation, transform.translation);
  return makeTransform(
    transform.to,
    transform.from,
    vector3(-rotated.x, -rotated.y, -rotated.z),
    inverseRotation,
  );
}

/** Build a transform chain through a frame tree and apply it. */
export function transformChain(
  transforms: Transform[],
  from: CoordinateFrame,
  to: CoordinateFrame,
): Transform {
  let composed: Transform | undefined;
  let current = from;
  for (const transform of transforms) {
    if (transform.from !== current) continue;
    composed = composed ? composeTransforms(composed, transform) : transform;
    current = transform.to;
    if (current === to) break;
  }
  if (!composed || current !== to) {
    throw new Error(`FRAME_MISMATCH: no transform chain from '${from}' to '${to}'.`);
  }
  return composed;
}

export interface FrameTree {
  /** parent frame → transforms out of it */
  transforms: Transform[];
}

/** Find and apply the transform taking `reference` into `target` frame. */
export function transformFrameReference(
  tree: FrameTree,
  reference: FrameReference,
  target: CoordinateFrame,
): FrameReference {
  if (reference.frame === target) return reference;
  const chain = transformChain(tree.transforms, reference.frame, target);
  return applyTransform(chain, reference);
}
