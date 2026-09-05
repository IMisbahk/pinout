"""Asyncio client for Pinout.

Requires the ``async`` extra::

    pip install pinout[async]

Mirrors the sync client surface with native coroutines and async iteration
over the daemon event stream.
"""

from __future__ import annotations

import json
import os
from typing import Any, AsyncIterator
from urllib.parse import quote

import httpx

from .errors import PinoutError

DEFAULT_BASE_URL = "http://127.0.0.1:8787"


class AsyncPinout:
    """Async entry point; same routes as the sync :class:`pinout.Pinout`."""

    def __init__(self, base_url: str | None = None, token: str | None = None,
                 owner: str | None = None, timeout: float = 30.0,
                 stream_timeout: float | None = None) -> None:
        url = (
            base_url
            or os.environ.get("PINOUT_DAEMON_URL")
            or os.environ.get("PINOUT_URL")
            or DEFAULT_BASE_URL
        )
        resolved_token = token if token is not None else os.environ.get("PINOUT_TOKEN")
        resolved_owner = owner if owner is not None else os.environ.get("PINOUT_OWNER")
        self._base_url = url.rstrip("/")
        self._owner = resolved_owner
        headers = {"authorization": f"Bearer {resolved_token}"} if resolved_token else {}
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers=headers,
            timeout=httpx.Timeout(timeout),
        )
        self._stream_timeout = stream_timeout

    async def __aenter__(self) -> "AsyncPinout":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, body: dict | None = None) -> Any:
        try:
            res = await self._client.request(method, path, json=body)
        except httpx.TransportError as err:
            raise PinoutError(
                f"Cannot reach Pinout daemon at {self._base_url}: {err}",
                code="DAEMON_UNREACHABLE",
                category="TRANSPORT",
                retryable=True,
            ) from None
        if res.status_code >= 400:
            try:
                payload = res.json()
            except Exception:
                payload = {"error": {"code": f"HTTP_{res.status_code}", "message": res.text,
                                    "category": "DEVICE", "retryable": False}}
            raise PinoutError.from_payload(payload)
        if not res.content:
            return {}
        return res.json()

    async def health(self) -> dict:
        return await self._request("GET", "/v1/health")

    async def devices(self) -> list[dict]:
        return (await self._request("GET", "/v1/devices"))["devices"]

    async def device_state(self, device_id: str) -> dict:
        return (await self._request("GET", f"/v1/devices/{device_id}/state"))["state"]

    async def device_info(self, device_id: str) -> dict:
        return await self._request("GET", f"/v1/devices/{device_id}")

    async def devices_info(self) -> list[dict]:
        return await self.devices()

    async def leases(self) -> list[dict]:
        return (await self._request("GET", "/v1/leases"))["leases"]

    async def acquire_lease(self, owner: str | None = None, device_id: str = "", ttl: float = 60.0,
                            mode: str = "exclusive") -> dict:
        effective_owner = owner or self._owner
        if not effective_owner:
            raise ValueError("owner is required to acquire a lease (provide owner or set PINOUT_OWNER)")
        payload = await self._request("POST", "/v1/leases", {
            "owner": effective_owner, "scope": {"kind": "device", "deviceId": device_id},
            "ttlMs": int(ttl * 1000), "mode": mode,
        })
        return payload["lease"]

    async def renew_lease(self, lease_id: str, owner: str | None = None, ttl: float = 60.0) -> dict:
        effective_owner = owner or self._owner
        if not effective_owner:
            raise ValueError("owner is required to renew a lease (provide owner or set PINOUT_OWNER)")
        payload = await self._request("POST", f"/v1/leases/{lease_id}/renew",
                                      {"owner": effective_owner, "ttlMs": int(ttl * 1000)})
        return payload["lease"]

    async def release_lease(self, lease_id: str, owner: str | None = None) -> None:
        effective_owner = owner or self._owner
        if not effective_owner:
            raise ValueError("owner is required to release a lease (provide owner or set PINOUT_OWNER)")
        await self._request("DELETE", f"/v1/leases/{lease_id}?owner={quote(effective_owner, safe='')}")

    async def dry_run(self, device_id: str, capability: str, args: dict | None = None,
                      owner: str | None = None) -> dict:
        effective_owner = owner if owner is not None else self._owner
        body: dict[str, Any] = {"capability": capability, "args": args or {}, "dryRun": True}
        if effective_owner:
            body["owner"] = effective_owner
        return await self._request("POST", f"/v1/devices/{device_id}/invoke", body)

    async def operations(self, device_id: str | None = None) -> list[dict]:
        path = "/v1/operations" + (f"?deviceId={device_id}" if device_id else "")
        return (await self._request("GET", path))["operations"]

    async def operation_status(self, operation_id: str) -> dict:
        return (await self._request("GET", f"/v1/operations/{operation_id}"))["operation"]

    async def invoke(self, device_id: str, capability: str, args: dict | None = None, *,
                     owner: str | None = None, timeout: float | None = None,
                     idempotency_key: str | None = None, wait: bool = False,
                     dry_run: bool = False) -> dict:
        body: dict[str, Any] = {"capability": capability, "args": args or {}}
        effective_owner = owner if owner is not None else self._owner
        if effective_owner:
            body["owner"] = effective_owner
        if timeout is not None:
            body["timeoutMs"] = int(timeout * 1000)
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key
        if dry_run:
            body["dryRun"] = True
        if wait:
            body["waitFor"] = "result"
        payload = await self._request("POST", f"/v1/devices/{device_id}/invoke", body)
        if body.get("dryRun"):
            return payload
        if wait:
            return payload.get("result", {})
        return payload

    async def wait_operation(self, operation_id: str, poll_interval: float = 0.1) -> dict:
        import asyncio
        while True:
            payload = await self._request("GET", f"/v1/operations/{operation_id}")
            snapshot = payload["operation"]
            if snapshot["status"] in ("completed", "failed", "cancelled", "timed_out", "rejected"):
                return snapshot
            await asyncio.sleep(poll_interval)

    async def operation_result(self, operation_id: str, poll_interval: float = 0.1) -> dict:
        snapshot = await self.wait_operation(operation_id, poll_interval)
        if snapshot["status"] != "completed":
            error = snapshot.get("error") or {}
            raise PinoutError.from_payload({"error": {**error, "code": error.get("code", snapshot["status"].upper())}})
        return snapshot.get("result", {})

    async def cancel_operation(self, operation_id: str, reason: str | None = None) -> dict:
        payload = await self._request("POST", f"/v1/operations/{operation_id}/cancel",
                                      {"reason": reason} if reason else None)
        return payload["operation"]

    async def events(self) -> AsyncIterator[dict]:
        """Yield daemon events as an async stream."""
        async with self._client.stream(
            "GET",
            "/v1/events",
            timeout=httpx.Timeout(30.0, read=self._stream_timeout),
        ) as res:
            res.raise_for_status()
            async for line in res.aiter_lines():
                if line.startswith("data: "):
                    yield json.loads(line[len("data: "):])

    async def journal(self, device_id: str | None = None, limit: int | None = None) -> list[dict]:
        params: list[str] = []
        if device_id:
            params.append(f"deviceId={device_id}")
        if limit:
            params.append(f"limit={limit}")
        path = "/v1/journal" + ("?" + "&".join(params) if params else "")
        return (await self._request("GET", path))["entries"]

    async def streams(self, device_id: str | None = None) -> list[dict]:
        path = "/v1/streams" + (f"?deviceId={device_id}" if device_id else "")
        return (await self._request("GET", path))["streams"]

    async def stream_snapshot(self, stream_id: str) -> dict:
        return (await self._request("GET", f"/v1/streams/{stream_id}/snapshot"))["frame"]

    async def halt(self, reason: str, actor: str | None = None) -> dict:
        effective_actor = actor or self._owner
        return await self._request("POST", "/v1/halt", {"reason": reason, "actor": effective_actor})

    async def resume(self, reason: str | None = None, actor: str | None = None) -> dict:
        effective_actor = actor or self._owner
        return await self._request("POST", "/v1/resume", {"reason": reason, "actor": effective_actor})

    async def safety(self) -> dict:
        return await self._request("GET", "/v1/safety")

    async def estop(self, reason: str, actor: str | None = None) -> dict:
        effective_actor = actor or self._owner
        return await self._request("POST", "/v1/estop", {"reason": reason, "actor": effective_actor})

    async def clear_estop(self, actor: str | None = None) -> dict:
        effective_actor = actor or self._owner
        return await self._request("POST", "/v1/estop/clear", {"actor": effective_actor})

    async def approve(self, approval_id: str, device_id: str, capability: str,
                      granted_by: str | None = None, expires_at: float | None = None,
                      granted_at: float | None = None) -> dict:
        effective_granter = granted_by or self._owner
        if not effective_granter:
            raise ValueError("granted_by is required (provide granted_by or set PINOUT_OWNER)")
        body: dict[str, Any] = {
            "id": approval_id,
            "deviceId": device_id,
            "capability": capability,
            "grantedBy": effective_granter,
        }
        if expires_at is not None:
            body["expiresAt"] = int(expires_at * 1000) if expires_at < 1e11 else int(expires_at)
        if granted_at is not None:
            body["grantedAt"] = int(granted_at * 1000) if granted_at < 1e11 else int(granted_at)
        return (await self._request("POST", "/v1/approvals", body))["approval"]

    async def heartbeat(self, device_id: str, actor: str | None = None) -> dict:
        effective_actor = actor or self._owner
        return await self._request("POST", f"/v1/devices/{device_id}/heartbeat",
                                   {"actor": effective_actor} if effective_actor else {})
