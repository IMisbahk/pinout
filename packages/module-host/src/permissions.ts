/**
 * Module permissions (spec v1).
 *
 * Declared review metadata from a module's manifest. These are NOT an OS
 * sandbox: Node.js cannot reliably enforce filesystem/network/process
 * restrictions on arbitrary third-party code, and Pinout does not pretend it
 * can. The actual isolation boundary is the out-of-process host (crash
 * isolation). Permissions exist so installers, reviewers, and policy engines
 * can make informed decisions and surface warnings.
 */
import type { ModuleManifestLike } from './manifestTypes.js';

export interface ModulePermissions {
  network?: { hosts: string[]; ports: number[] };
  serial?: { vendorIds: number[]; productIds: number[] };
  usb?: { vendorIds: number[]; productIds: number[] };
  filesystem?: { read: string[]; write: string[] };
  environment?: { keys: string[] };
  subprocess?: boolean;
  bluetooth?: boolean;
}

export interface PermissionFinding {
  severity: 'info' | 'warning' | 'critical';
  permission: string;
  message: string;
}

export function parseModulePermissions(manifest: ModuleManifestLike): ModulePermissions {
  const permissions = (manifest.permissions ?? {}) as ModulePermissions;
  return {
    ...(permissions.network ? { network: permissions.network } : {}),
    ...(permissions.serial ? { serial: permissions.serial } : {}),
    ...(permissions.usb ? { usb: permissions.usb } : {}),
    ...(permissions.filesystem ? { filesystem: permissions.filesystem } : {}),
    ...(permissions.environment ? { environment: permissions.environment } : {}),
    ...(permissions.subprocess !== undefined ? { subprocess: permissions.subprocess } : {}),
    ...(permissions.bluetooth !== undefined ? { bluetooth: permissions.bluetooth } : {}),
  };
}

/** Audit declared permissions; findings are advisory, never enforcement. */
export function auditPermissions(manifest: ModuleManifestLike): PermissionFinding[] {
  const permissions = parseModulePermissions(manifest);
  const findings: PermissionFinding[] = [];

  if (permissions.subprocess === true) {
    findings.push({
      severity: 'critical',
      permission: 'subprocess',
      message:
        'Module declares subprocess execution. Out-of-process isolation does NOT constrain what subprocesses can do.',
    });
  }
  if (permissions.environment?.keys?.length) {
    findings.push({
      severity: 'warning',
      permission: 'environment',
      message: `Module declares access to environment variables: ${permissions.environment.keys.join(', ')}. Ensure no secrets are exposed to untrusted modules.`,
    });
  }
  if (permissions.filesystem?.write?.length) {
    findings.push({
      severity: 'warning',
      permission: 'filesystem.write',
      message: `Module declares write access to: ${permissions.filesystem.write.join(', ')}. Review for path-escape risk.`,
    });
  }
  if (permissions.network?.hosts?.length) {
    findings.push({
      severity: 'info',
      permission: 'network',
      message: `Module declares network access to: ${permissions.network.hosts.join(', ')}:${permissions.network.ports?.join(',') ?? '*'}.`,
    });
  }
  if (permissions.bluetooth === true) {
    findings.push({
      severity: 'info',
      permission: 'bluetooth',
      message: 'Module declares Bluetooth access.',
    });
  }
  if (Object.keys(permissions).length === 0) {
    findings.push({
      severity: 'info',
      permission: 'none',
      message:
        'Module declares no permissions. Declare what you use — reviewers cannot audit an empty promise.',
    });
  }
  return findings;
}
