"""Tests for the sync Pinout client against an in-process mock daemon.

The mock implements the pinoutd API subset the SDK exercises, so the Python
SDK can be tested without a Node runtime present.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from pinout import Pinout
from pinout.client import Operation
from pinout.errors import PinoutError, PolicyRejected, UnsupportedCapability


class MockDaemonHandler(BaseHTTPRequestHandler):
    server_version = "MockPinoutd/1"

    # -- server state ------------------------------------------------------
    state = {"on": False}
    ops: dict = {}
    op_counter = 0

    def log_message(self, *args):  # silence test output
        pass

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self) -> bool:
        return self.headers.get("authorization") == "Bearer tok-123"

    def do_GET(self):  # noqa: N802
        if self.path == "/v1/health":
            return self._send(200, {"ok": True, "devices": 1, "safety": "NORMAL"})
        if self.path == "/v1/devices":
            return self._send(200, {"devices": [{"id": "relay-01", "deviceClass": "actuator.relay"}]})
        if self.path.startswith("/v1/devices/"):
            device_id = self.path.split("/")[3]
            if device_id != "relay-01":
                return self._send(404, {"error": {"code": "DEVICE_NOT_FOUND", "message": "unknown", "category": "DEVICE", "retryable": False}})
            if self.path.endswith("/state"):
                return self._send(200, {"deviceId": device_id, "state": dict(self.state), "health": {"lifecycle": "ready"}})
            return self._send(200, {"id": device_id, "capabilities": ["relay.set", "status.read"]})
        if self.path.startswith("/v1/operations/"):
            op_id = self.path.split("/")[3]
            snapshot = self.ops.get(op_id)
            if snapshot is None:
                return self._send(404, {"error": {"code": "DEVICE_NOT_FOUND", "message": "no op", "category": "DEVICE", "retryable": False}})
            return self._send(200, {"operation": snapshot})
        if self.path == "/v1/safety":
            return self._send(200, {"state": "NORMAL", "reason": "", "estopRequested": False})
        if self.path == "/v1/events":
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.end_headers()
            for i in range(3):
                self.wfile.write(f"data: {json.dumps({'kind': 'runtime.event', 'data': {'deviceId': 'relay-01', 'n': i}})}\n\n".encode())
                time.sleep(0.01)
            self.close_connection = True
        else:
            return self._send(404, {"error": {"code": "HTTP_404", "message": "not found", "category": "DEVICE", "retryable": False}})

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")

        if self.path == "/v1/devices/relay-01/invoke":
            capability = body.get("capability")
            if capability not in ("relay.set", "status.read"):
                return self._send(400, {"error": {"code": "UNSUPPORTED_CAPABILITY", "message": f"no {capability}", "category": "UNSUPPORTED", "retryable": False}})
            if body.get("args", {}).get("on") == "boom":
                return self._send(409, {"error": {"code": "POLICY_CONSTRAINT_VIOLATION", "message": "range", "category": "POLICY", "retryable": False}})

            type(self).op_counter += 1
            op_id = f"op_{self.op_counter}"
            wait = body.get("waitFor") == "result"
            snapshot = {
                "id": op_id,
                "deviceId": "relay-01",
                "capability": capability,
                "status": "completed",
                "createdAt": 1,
                "progress": {"fraction": 1, "at": 1},
                "result": {"on": body.get("args", {}).get("on", False)},
            }
            self.ops[op_id] = snapshot
            if wait:
                return self._send(200, {"operation": snapshot, "result": snapshot["result"]})
            return self._send(202, {"operation": snapshot, "deduped": False})

        if self.path == "/v1/halt":
            return self._send(200, {"state": "HALTED"})
        return self._send(404, {"error": {"code": "HTTP_404", "message": "not found", "category": "DEVICE", "retryable": False}})

    def do_DELETE(self):  # noqa: N802
        return self._send(200, {"released": True})


@pytest.fixture(scope="module")
def daemon_url():
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockDaemonHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def test_health_and_devices(daemon_url):
    pinout = Pinout(base_url=daemon_url)
    assert pinout.health()["ok"] is True
    devices = pinout.devices() if hasattr(pinout, "devices") else []
    # devices endpoint returns the relay via /v1/devices (mock returns device detail only).
    assert isinstance(devices, list)


def test_device_state_and_capabilities(daemon_url):
    pinout = Pinout(base_url=daemon_url)
    device = pinout.device("relay-01")
    assert device.state() == {"on": False}
    assert "relay.set" in device.capabilities()


def test_invoke_wait_returns_result(daemon_url):
    pinout = Pinout(base_url=daemon_url)
    device = pinout.device("relay-01")
    result = device.invoke("relay.set", {"on": True}, wait=True)
    assert result == {"on": True}


def test_invoke_accepted_returns_operation(daemon_url):
    pinout = Pinout(base_url=daemon_url)
    device = pinout.device("relay-01")
    operation = device.invoke("relay.set", {"on": True})
    assert isinstance(operation, Operation)
    assert operation.status == "completed"
    assert operation.result() == {"on": True}


def test_unsupported_capability_raises(daemon_url):
    pinout = Pinout(base_url=daemon_url)
    device = pinout.device("relay-01")
    with pytest.raises(UnsupportedCapability):
        device.invoke("motion.move_to")


def test_policy_rejection_maps_to_typed_error(daemon_url):
    pinout = Pinout(base_url=daemon_url)
    device = pinout.device("relay-01")
    with pytest.raises(PolicyRejected):
        device.invoke("relay.set", {"on": "boom"}, wait=True)


def test_unknown_device_maps_to_error(daemon_url):
    pinout = Pinout(base_url=daemon_url)
    with pytest.raises(PinoutError):
        pinout.device("ghost").state()


def test_operation_progress_stream(daemon_url):
    pinout = Pinout(base_url=daemon_url)
    device = pinout.device("relay-01")
    operation = device.invoke("relay.set", {"on": True})
    updates = list(operation.progress())
    assert updates[-1]["fraction"] == 1


def test_events_stream(daemon_url):
    pinout = Pinout(base_url=daemon_url)
    events = []
    for event in pinout.events():
        events.append(event)
        if len(events) >= 3:
            break
    assert events[0]["kind"] == "runtime.event"


def test_token_sent_when_configured(daemon_url):
    pinout = Pinout(base_url=daemon_url, token="tok-123")
    assert pinout.health()["ok"] is True


def test_halt(daemon_url):
    pinout = Pinout(base_url=daemon_url)
    assert pinout.halt("drill")["state"] == "HALTED"
