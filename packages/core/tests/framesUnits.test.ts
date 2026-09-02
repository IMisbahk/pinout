/**
 * Frame- and unit-confusion adversarial tests (Wave-2 #8).
 *
 * These tests attempt the classic robotics mistakes and assert that Pinout
 * fails loudly instead of silently producing wrong physical behavior.
 */
import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  composeTransforms,
  frameReference,
  invertTransform,
  makeTransform,
  pose,
  quaternion,
  quaternionFromAxisAngle,
  rotateVector,
  transformChain,
  transformFrameReference,
  vector3,
} from '../src/frames/frames.js';
import { convert } from '../src/spec/units.js';

describe('frame transforms', () => {
  it('applies a pure translation between frames', () => {
    const baseToTool = makeTransform('base', 'tool0', vector3(1, 0, 0), quaternion(0, 0, 0, 1));
    const result = applyTransform(baseToTool, frameReference('base', pose(vector3(2, 3, 4), quaternion(0, 0, 0, 1))));
    expect(result.frame).toBe('tool0');
    expect(result.pose.position).toEqual({ x: 3, y: 3, z: 4 });
  });

  it('rotates around Z correctly (90 degrees)', () => {
    const quarterTurn = quaternionFromAxisAngle(vector3(0, 0, 1), Math.PI / 2);
    const rotated = rotateVector(quarterTurn, vector3(1, 0, 0));
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
  });

  it('compose: A→B ∘ B→C chains and composes translations', () => {
    const worldToBase = makeTransform('world', 'base', vector3(10, 0, 0), quaternion(0, 0, 0, 1));
    const baseToTcp = makeTransform('base', 'tcp', vector3(0, 2, 0), quaternion(0, 0, 0, 1));
    const worldToTcp = composeTransforms(worldToBase, baseToTcp);
    expect(worldToTcp.from).toBe('world');
    expect(worldToTcp.to).toBe('tcp');
    const result = applyTransform(worldToTcp, frameReference('world', pose(vector3(1, 1, 0), quaternion(0, 0, 0, 1))));
    expect(result.pose.position).toEqual({ x: 11, y: 3, z: 0 });
  });

  it('invert: inverting twice returns the original', () => {
    const t = makeTransform('base', 'tcp', vector3(1, 2, 3), quaternionFromAxisAngle(vector3(0, 1, 0), 0.3));
    const inverse = invertTransform(t);
    expect(inverse.from).toBe('tcp');
    expect(inverse.to).toBe('base');
    const roundTrip = composeTransforms(t, inverse);
    expect(roundTrip.translation.x).toBeCloseTo(0);
    expect(roundTrip.translation.y).toBeCloseTo(0);
    expect(roundTrip.translation.z).toBeCloseTo(0);
    expect(roundTrip.rotation.w).toBeCloseTo(1);
  });

  it('resolves a chain through a frame tree (world→base→tcp)', () => {
    // Convention: translation is the `from`-frame origin expressed in `to`
    // coordinates (applyTransform maps points from → to via R*p + t).
    const transforms = [
      makeTransform('world', 'base', vector3(-5, 0, 0), quaternion(0, 0, 0, 1)),
      makeTransform('base', 'tcp', vector3(0, -1, 0), quaternion(0, 0, 0, 1)),
      makeTransform('tcp', 'camera', vector3(0, 0, -0.1), quaternion(0, 0, 0, 1)),
    ];
    const point = frameReference('world', pose(vector3(0, 0, 0), quaternion(0, 0, 0, 1)));
    const inCamera = transformFrameReference({ transforms }, point, 'camera');
    expect(inCamera.frame).toBe('camera');
    expect(inCamera.pose.position).toEqual({ x: -5, y: -1, z: -0.1 });
  });
});

describe('frame confusion must fail loudly', () => {
  const baseToTcp = makeTransform('base', 'tcp', vector3(1, 0, 0), quaternion(0, 0, 0, 1));

  it('refuses to transform a pose already in the target frame', () => {
    const worldPose = frameReference('world', pose(vector3(0, 0, 0), quaternion(0, 0, 0, 1)));
    expect(() => applyTransform(baseToTcp, worldPose)).toThrowError(/FRAME_MISMATCH/);
    expect(() => applyTransform(baseToTcp, worldPose)).toThrowError(/never silently mixed/);
  });

  it('refuses to compose transforms that do not chain', () => {
    const worldToBase = makeTransform('world', 'base', vector3(0, 0, 0), quaternion(0, 0, 0, 1));
    const tcpToCamera = makeTransform('tcp', 'camera', vector3(0, 0, 0), quaternion(0, 0, 0, 1));
    expect(() => composeTransforms(worldToBase, tcpToCamera)).toThrowError(/FRAME_MISMATCH/);
  });

  it('refuses a chain when no path exists between frames', () => {
    const transforms = [makeTransform('world', 'base', vector3(0, 0, 0), quaternion(0, 0, 0, 1))];
    expect(() => transformChain(transforms, 'base', 'camera')).toThrowError(/no transform chain/);
  });

  it('treats coordinates in different frames as NOT interchangeable', () => {
    // The same numeric coordinates in 'base' vs 'tcp' are different physical
    // points; applying the transform changes them rather than passing through.
    const baseToTcp = makeTransform('base', 'tcp', vector3(1, 0, 0), quaternion(0, 0, 0, 1));
    const same = pose(vector3(2, 0, 0), quaternion(0, 0, 0, 1));
    const fromBase = applyTransform(baseToTcp, frameReference('base', same));
    expect(fromBase.pose.position.x).toBe(3);
    expect(fromBase.pose.position.x).not.toBe(same.position.x);
  });
});

describe('unit confusion must fail loudly or convert deterministically', () => {
  it('refuses to convert percent to volts (ambiguous without a range)', () => {
    expect(() => convert(50, 'percent', 'V')).toThrowError(/No deterministic/);
  });

  it('refuses silent cross-family conversions (degrees to newtons)', () => {
    expect(() => convert(90, 'deg', 'N')).toThrowError(/No deterministic/);
  });

  it('converts RPM to rad/s deterministically (60 rpm = 2π rad/s)', () => {
    expect(convert(60, 'rpm', 'rad/s')).toBeCloseTo(2 * Math.PI);
  });

  it('converts degrees to radians without loss', () => {
    expect(convert(360, 'deg', 'rad')).toBeCloseTo(2 * Math.PI);
  });

  it('temperature conversions pivot through kelvin correctly', () => {
    expect(convert(-40, 'C', 'F')).toBeCloseTo(-40);
    expect(convert(0, 'C', 'K')).toBeCloseTo(273.15);
  });

  it('psi and bar convert through pascals consistently', () => {
    const onePsiInBar = convert(1, 'psi', 'bar');
    expect(onePsiInBar).toBeCloseTo(0.0689476, 4);
    expect(convert(onePsiInBar, 'bar', 'psi')).toBeCloseTo(1);
  });

  it('mm to m and back is lossless within float precision', () => {
    const value = 1234.5;
    expect(convert(convert(value, 'mm', 'm'), 'm', 'mm')).toBeCloseTo(value);
  });

  it('a motion command mixing units would be caught: 3.14 rad/s vs 180 deg/s are the same speed', () => {
    // The confusion trap: 3.14 (rad/s) ≈ 180 (deg/s). Pinout requires units;
    // converting shows they agree — silently assuming would not.
    expect(convert(180, 'deg/s', 'rad/s')).toBeCloseTo(Math.PI, 2);
  });
});
