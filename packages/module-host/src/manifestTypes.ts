/** Minimal structural type for the fields module-host reads from a manifest. */
export interface ModuleManifestLike {
  id?: string;
  version?: string;
  publisher?: string;
  runtime?: string;
  permissions?: unknown;
  capabilities?: unknown;
  [key: string]: unknown;
}
