"""Sync Pinout client (stdlib only).

Requests hit a local ``pinoutd`` daemon. Never commit device addresses or
tokens to source control — pass them via arguments or environment.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Iterator

from .errors import PinoutError, Timeout

DEFAULT_BASE_URL = "http://127.0.0.1:8787"


class _Http:
    """Minimal JSON HTTP layer with bearer-token support."""

    def __init__(self, base_url: str, token: str | None = None, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def request(self, method: str, path: str, body: dict | None = None,
                stream: bool = False) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={
                "content-type": "application/json",
                **({"authorization": f"Bearer {self.token}"} if self.token else {}),
            },
        )
        try:
            res = urllib.request.urlopen(req, timeout=self.timeout)
        except urllib.error.HTTPError as err:
            payload = self._read_error(err)
            raise PinoutError.from_payload(payload) from None
        except urllib.error.URLError as err:
            raise PinoutError(
                f"Cannot reach Pinout daemon at {self.base_url}: {err.reason}",
                code="DAEMON_UNREACHABLE",
                category="TRANSPORT",
                retryable=True,
            ) from None

        if stream:
            return res
        raw = res.read()
        return json.loads(raw) if raw else {}

    @staticmethod
    def _read_error(err: urllib.error.HTTPError) -> dict:
        try:
            return json.loads(err.read().decode())
        except Exception:
            return {"error": {"code": f"HTTP_{err.code}", "message": str(err.reason),
                              "category": "DEVICE", "retryable": False}}


class Operation:
    """A handle to a long-running operation on the daemon."""

    def __init__(self, http: _Http, snapshot: dict) -> None:
        self._http = http
        self._snapshot = snapshot

    @property
    def id(self) -> str:
        return self._snapshot["id"]

    @property
    def status(self) -> str:
        return self._snapshot["status"]

    def reload(self) -> dict:
        """Fetch the latest snapshot from the daemon."""
        payload = self._http.request("GET", f"/v1/operations/{self.id}")
        self._snapshot = payload["operation"]
        return self._snapshot

    def wait(self, poll_interval: float = 0.1, timeout: float | None = None) -> dict:
        """Block until the operation reaches a terminal state; return the snapshot.

        Raises :class:`OperationFailed` or :class:`Timeout` on failure paths.
        """
        deadline = time.monotonic() + timeout if timeout is not None else None
        while True:
            snapshot = self.reload()
            if snapshot["status"] in ("completed", "failed", "cancelled", "timed_out", "rejected"):
                return snapshot
            if deadline is not None and time.monotonic() > deadline:
                raise Timeout(f"Operation {self.id} did not finish within the timeout.")
            time.sleep(poll_interval)

    def result(self, poll_interval: float = 0.1, timeout: float | None = None) -> dict:
        """Wait for completion and return the result payload."""
        snapshot = self.wait(poll_interval=poll_interval, timeout=timeout)
        if snapshot["status"] != "completed":
            error = snapshot.get("error") or {}
            raise PinoutError.from_payload({"error": {**error, "code": error.get("code", snapshot["status"].upper())}})
        return snapshot.get("result", {})

    def progress(self) -> Iterator[dict]:
        """Yield progress snapshots until the operation is terminal."""
        last: dict | None = None
        while True:
            snapshot = self.reload()
            progress = snapshot.get("progress")
            if progress is not None and progress != last:
                last = progress
                yield progress
            if snapshot["status"] in ("completed", "failed", "cancelled", "timed_out", "rejected"):
                return
            time.sleep(0.1)

    def cancel(self, reason: str | None = None) -> dict:
        body = {"reason": reason} if reason else None
        payload = self._http.request("POST", f"/v1/operations/{self.id}/cancel", body)
        self._snapshot = payload["operation"]
        return self._snapshot


class Device:
    """A device hosted by the daemon."""

    def __init__(self, http: _Http, device_id: str) -> None:
        self._http = http
        self.id = device_id

    def info(self) -> dict:
        return self._http.request("GET", f"/v1/devices/{self.id}")

    def state(self) -> dict:
        payload = self._http.request("GET", f"/v1/devices/{self.id}/state")
        return payload["state"]

    def capabilities(self) -> list[str]:
        return self.info()["capabilities"]

    def invoke(
        self,
        capability: str,
        args: dict | None = None,
        *,
        wait: bool = False,
        timeout: float | None = None,
        idempotency_key: str | None = None,
        owner: str | None = None,
        dry_run: bool = False,
    ) -> dict | Operation:
        """Invoke a capability.

        Returns the result dict when ``wait=True`` (immediate semantics), or an
        :class:`Operation` handle otherwise. Use ``dry_run=True`` to preview the
        policy-resolved request without physical side effects.
        """
        body: dict[str, Any] = {"capability": capability, "args": args or {}}
        if wait:
            body["waitFor"] = "result"
        if timeout is not None:
            body["timeoutMs"] = int(timeout * 1000)
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key
        if owner:
            body["owner"] = owner
        if dry_run:
            body["dryRun"] = True

        payload = self._http.request("POST", f"/v1/devices/{self.id}/invoke", body)
        if body.get("dryRun"):
            return payload
        if wait:
            return payload["result"]
        return Operation(self._http, payload["operation"])

    def acquire_lease(self, owner: str, ttl: float = 60.0, mode: str = "exclusive") -> dict:
        payload = self._http.request("POST", "/v1/leases", {
            "owner": owner,
            "scope": {"kind": "device", "deviceId": self.id},
            "ttlMs": int(ttl * 1000),
            "mode": mode,
        })
        return payload["lease"]

    def release_lease(self, lease_id: str) -> None:
        self._http.request("DELETE", f"/v1/leases/{lease_id}?owner=", {})


class Pinout:
    """Entry point for the sync Python SDK.

    ``base_url`` defaults to ``PINOUT_URL`` or the standard local daemon
    address. Tokens default to ``PINOUT_TOKEN``; prefer environment variables
    over literals in code.
    """

    def __init__(self, base_url: str | None = None, token: str | None = None) -> None:
        url = base_url or os.environ.get("PINOUT_URL") or DEFAULT_BASE_URL
        self._http = _Http(url, token or os.environ.get("PINOUT_TOKEN"))

    def health(self) -> dict:
        return self._http.request("GET", "/v1/health")

    def devices(self) -> list[dict]:
        return self._http.request("GET", "/v1/devices")["devices"]

    def device(self, device_id: str) -> Device:
        return Device(self._http, device_id)

    def operations(self, device_id: str | None = None) -> list[dict]:
        path = "/v1/operations" + (f"?deviceId={device_id}" if device_id else "")
        return self._http.request("GET", path)["operations"]

    def leases(self) -> list[dict]:
        return self._http.request("GET", "/v1/leases")["leases"]

    # -- Safety ----------------------------------------------------------------

    def safety(self) -> dict:
        return self._http.request("GET", "/v1/safety")

    def halt(self, reason: str, actor: str | None = None) -> dict:
        return self._http.request("POST", "/v1/halt", {"reason": reason, "actor": actor})

    def resume(self, reason: str | None = None, actor: str | None = None) -> dict:
        return self._http.request("POST", "/v1/resume", {"reason": reason, "actor": actor})

    def estop(self, reason: str, actor: str | None = None) -> dict:
        """Software emergency-stop request. NOT a certified e-stop system."""
        return self._http.request("POST", "/v1/estop", {"reason": reason, "actor": actor})

    def clear_estop(self, actor: str | None = None) -> dict:
        return self._http.request("POST", "/v1/estop/clear", {"actor": actor})

    # -- Events ------------------------------------------------------------------

    def events(self) -> Iterator[dict]:
        """Stream daemon events (Server-Sent Events) as parsed dicts."""
        res: Any = self._http.request("GET", "/v1/events", stream=True)
        try:
            for raw_line in res:
                line = raw_line.decode().strip()
                if line.startswith("data: "):
                    yield json.loads(line[len("data: "):])
        finally:
            res.close()

    def journal(self, device_id: str | None = None, limit: int | None = None) -> list[dict]:
        params: list[str] = []
        if device_id:
            params.append(f"deviceId={device_id}")
        if limit:
            params.append(f"limit={limit}")
        path = "/v1/journal" + ("?" + "&".join(params) if params else "")
        return self._http.request("GET", path)["entries"]

    def streams(self, device_id: str | None = None) -> list[dict]:
        path = "/v1/streams" + (f"?deviceId={device_id}" if device_id else "")
        return self._http.request("GET", path)["streams"]


def watch(device_id: str, handler: Callable[[dict], None], base_url: str | None = None,
          token: str | None = None) -> None:
    """Blocking event watch helper: calls ``handler`` for each daemon event."""
    pinout = Pinout(base_url=base_url, token=token)
    for event in pinout.events():
        if event.get("kind") == "runtime.event" and event.get("data", {}).get("deviceId") == device_id:
            handler(event["data"])
