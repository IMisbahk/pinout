/** Shared manifest shape; optional fields preserve conformance reporting for partial records. */
import type { PinoutModuleManifest } from '@pinout/core';

export type ModuleManifestLike = Partial<PinoutModuleManifest> & Record<string, unknown>;
