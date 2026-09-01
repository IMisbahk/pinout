/**
 * Pinout specification version.
 *
 * Every serializable structure defined in `packages/core/src/spec` carries this
 * version. Bump MINOR for additive changes, MAJOR for breaking changes to
 * existing serialized shapes. Consumers must reject envelopes whose major
 * version they do not understand.
 */
export const SPEC_VERSION = '1.0';

export const SPEC_VERSION_MAJOR = 1;

/** Check whether a serialized envelope declares a compatible spec version. */
export function isCompatibleSpecVersion(version: string | undefined): boolean {
  if (!version) return false;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isInteger(major) && major === SPEC_VERSION_MAJOR;
}
