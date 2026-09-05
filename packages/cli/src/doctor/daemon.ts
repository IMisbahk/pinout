import type { DoctorCheckResult, DoctorDependencies, DoctorOptions } from './types.js';

export async function checkDaemon(
  options: DoctorOptions,
  deps: DoctorDependencies,
): Promise<DoctorCheckResult> {
  if (options.daemon === false) {
    return {
      stage: 'daemon',
      name: 'daemon-health',
      status: 'skip',
      detail: 'Daemon check skipped via --no-daemon flag.',
    };
  }

  const env = deps.env ?? process.env;
  const isExplicitUrl = options.url !== undefined || env.PINOUT_DAEMON_URL !== undefined;
  const targetUrl =
    options.url ??
    env.PINOUT_DAEMON_URL ??
    env.PINOUT_URL ??
    'http://127.0.0.1:8787';

  const token = env.PINOUT_TOKEN;
  const fetchFn = deps.fetch ?? globalThis.fetch;

  try {
    const headers: Record<string, string> = {};
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetchFn(`${targetUrl}/v1/health`, {
      method: 'GET',
      headers,
    });

    if (response.status === 401 || response.status === 403) {
      return {
        stage: 'daemon',
        name: 'daemon-health',
        status: 'fail',
        detail: `Daemon at ${targetUrl} rejected authentication (HTTP ${response.status}).`,
        nextStep:
          'Set or verify the PINOUT_TOKEN environment variable matches the daemon token configuration.',
        meta: { url: targetUrl, httpStatus: response.status },
      };
    }

    if (!response.ok) {
      return {
        stage: 'daemon',
        name: 'daemon-health',
        status: 'fail',
        detail: `Daemon at ${targetUrl} returned HTTP ${response.status}.`,
        nextStep: `Inspect daemon logs with 'pinout logs' or restart the daemon service.`,
        meta: { url: targetUrl, httpStatus: response.status },
      };
    }

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const isOk = payload.ok === true;
    const deviceCount = typeof payload.devices === 'number' ? payload.devices : undefined;
    const version = typeof payload.version === 'string' ? payload.version : undefined;

    const extra = [
      isOk ? 'healthy' : 'degraded',
      version ? `v${version}` : undefined,
      deviceCount !== undefined ? `${deviceCount} device(s)` : undefined,
    ]
      .filter(Boolean)
      .join(', ');

    return {
      stage: 'daemon',
      name: 'daemon-health',
      status: 'pass',
      detail: `Reachable at ${targetUrl} (${extra})`,
      meta: { url: targetUrl, payload },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = isExplicitUrl ? 'fail' : 'warn';
    return {
      stage: 'daemon',
      name: 'daemon-health',
      status,
      detail: `Cannot reach Pinout daemon at ${targetUrl} (${errorMessage}). Governed multi-agent leases and MCP require the daemon; direct CLI commands work without it.`,
      nextStep: `Start the daemon with 'node packages/daemon/dist/main.js --demo' or 'pinoutd', or check PINOUT_DAEMON_URL.`,
      meta: { url: targetUrl, error: errorMessage, explicitUrl: isExplicitUrl },
    };
  }
}
