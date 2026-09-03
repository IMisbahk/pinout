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

import httpx

from .errors import PinoutError

DEFAULT_BASE_URL = "http://127.0.0.1:8787"


class AsyncPinout:
    """Async entry point; same routes as the sync :class:`pinout.Pinout`."""

    def __init__(self, base_url: str | None = None, token: str | None = None) -> None:
        url = base_url or os.environ.get("PINOUT_URL") or DEFAULT_BASE_URL
        headers = {"authorization": f"Bearer {token}"} if (token or os.environ.get("PINOUT_TOKEN")) else {}
        self._client = httpx.AsyncClient(
            base_url=url.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(30.0, read=None),
        )

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
                f"Cannot reach Pinout daemon: {err}",
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

    async def invoke(self, device_id: str, capability: str, args: dict | None = None, *,
                     owner: str | None = None, timeout: float | None = None,
                     idempotency_key: str | None = None) -> dict:
        body: dict[str, Any] = {"capability": capability, "args": args or {}}
        if owner:
            body["owner"] = owner
        if timeout is not None:
            body["timeoutMs"] = int(timeout * 1000)
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key
        return await self._request("POST", f"/v1/devices/{device_id}/invoke", body)

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
        async with self._client.stream("GET", "/v1/events") as res:
            res.raise_for_status()
            async for line in res.aiter_lines():
                if line.startswith("data: "):
                    yield json.loads(line[len("data: "):])

    async def halt(self, reason: str, actor: str | None = None) -> dict:
        return await self._request("POST", "/v1/halt", {"reason": reason, "actor": actor})

    async def resume(self, reason: str | None = None, actor: str | None = None) -> dict:
        return await self._request("POST", "/v1/resume", {"reason": reason, "actor": actor})

    async def safety(self) -> dict:
        return await self._request("GET", "/v1/safety")
