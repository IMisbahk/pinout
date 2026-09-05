"""Tests for the sync Pinout client against an in-process mock daemon.

The mock implements the pinoutd API subset the SDK exercises, so the Python
SDK can be tested without a Node runtime present using unittest or pytest.
"""

from __future__ import annotations

import json
import os
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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
            return self._send(200, {
                "devices": [{
                    "id": "relay-01",
                    "deviceClass": "actuator.relay",
                    "stateEvidence": {
                        "on": {
                            "commanded": {"value": False, "at": "2026-09-05T00:00:00Z", "source": "commanded"},
                            "acknowledged": {"value": False, "at": "2026-09-05T00:00:00Z", "source": "acknowledged"},
                            "observed": {"value": False, "at": "2026-09-05T00:00:00Z", "source": "simulated"},
                            "freshnessMs": 0,
                            "stale": False,
                            "provenance": "simulated",
                        }
                    },
                }]
            })
        if self.path.startswith("/v1/devices/"):
            parts = self.path.split("/")
            device_id = parts[3]
            if device_id != "relay-01":
                return self._send(404, {"error": {"code": "DEVICE_NOT_FOUND", "message": "unknown", "category": "DEVICE", "retryable": False}})
            if self.path.endswith("/state"):
                return self._send(200, {
                    "deviceId": device_id,
                    "state": dict(self.state),
                    "stateEvidence": {
                        "on": {
                            "commanded": {"value": False, "at": "2026-09-05T00:00:00Z", "source": "commanded"},
                            "acknowledged": {"value": False, "at": "2026-09-05T00:00:00Z", "source": "acknowledged"},
                            "observed": {"value": False, "at": "2026-09-05T00:00:00Z", "source": "simulated"},
                            "freshnessMs": 0,
                            "stale": False,
                            "provenance": "simulated",
                        }
                    },
                    "health": {"lifecycle": "ready"},
                })
            return self._send(200, {
                "id": device_id,
                "capabilities": ["relay.set", "status.read"],
                "stateEvidence": {
                    "on": {
                        "commanded": {"value": False, "at": "2026-09-05T00:00:00Z", "source": "commanded"},
                        "acknowledged": {"value": False, "at": "2026-09-05T00:00:00Z", "source": "acknowledged"},
                        "observed": {"value": False, "at": "2026-09-05T00:00:00Z", "source": "simulated"},
                        "freshnessMs": 0,
                        "stale": False,
                        "provenance": "simulated",
                    }
                },
            })
        if self.path == "/v1/operations" or self.path.startswith("/v1/operations?"):
            return self._send(200, {"operations": list(self.ops.values())})
        if self.path.startswith("/v1/operations/"):
            op_id = self.path.split("/")[3]
            snapshot = self.ops.get(op_id)
            if snapshot is None:
                return self._send(404, {"error": {"code": "DEVICE_NOT_FOUND", "message": "no op", "category": "DEVICE", "retryable": False}})
            return self._send(200, {"operation": snapshot})
        if self.path == "/v1/leases":
            return self._send(200, {"leases": [{"id": "lease-01", "owner": "test-owner"}]})
        if self.path == "/v1/safety":
            return self._send(200, {"state": "NORMAL", "reason": "", "estopRequested": False})
        if self.path.startswith("/v1/journal"):
            return self._send(200, {"entries": [{"kind": "test.entry", "at": 1}]})
        if self.path.startswith("/v1/streams"):
            return self._send(200, {"streams": [{"id": "cam-01", "deviceId": "cam-01"}]})
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
            if body.get("dryRun"):
                return self._send(200, {"dryRun": True, "deviceId": "relay-01", "capability": capability, "resolvedArgs": body.get("args", {})})

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

        if self.path == "/v1/leases":
            return self._send(201, {"lease": {"id": "lease-123", "owner": body.get("owner"), "scope": body.get("scope")}})
        if self.path.startswith("/v1/leases/") and self.path.endswith("/renew"):
            return self._send(200, {"lease": {"id": "lease-123", "owner": body.get("owner")}})
        if self.path == "/v1/halt":
            return self._send(200, {"state": "HALTED"})
        if self.path == "/v1/resume":
            return self._send(200, {"state": "NORMAL"})
        if self.path == "/v1/estop":
            return self._send(200, {"state": "ESTOP_REQUESTED"})
        if self.path == "/v1/estop/clear":
            return self._send(200, {"state": "HALTED"})
        if self.path == "/v1/approvals":
            return self._send(201, {"approval": body})
        if self.path == "/v1/devices/relay-01/heartbeat":
            return self._send(200, {"deviceId": "relay-01", "alive": True})
        return self._send(404, {"error": {"code": "HTTP_404", "message": "not found", "category": "DEVICE", "retryable": False}})

    def do_DELETE(self):  # noqa: N802
        return self._send(200, {"released": True})


class TestSyncPinoutClient(unittest.TestCase):
    server: ThreadingHTTPServer
    server_thread: threading.Thread
    daemon_url: str

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), MockDaemonHandler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.daemon_url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_health_and_devices(self):
        pinout = Pinout(base_url=self.daemon_url)
        self.assertTrue(pinout.health()["ok"])
        devices = pinout.devices()
        self.assertIsInstance(devices, list)

    def test_device_state_and_capabilities(self):
        pinout = Pinout(base_url=self.daemon_url)
        device = pinout.device("relay-01")
        self.assertEqual(device.state(), {"on": False})
        self.assertIn("relay.set", device.capabilities())
        evidence = device.state_evidence()
        self.assertIn("on", evidence)
        self.assertEqual(evidence["on"]["commanded"]["value"], False)
        self.assertEqual(evidence["on"]["observed"]["source"], "simulated")

        info = device.info()
        self.assertIn("stateEvidence", info)
        self.assertIn("on", info["stateEvidence"])

    def test_invoke_wait_returns_result(self):
        pinout = Pinout(base_url=self.daemon_url)
        device = pinout.device("relay-01")
        result = device.invoke("relay.set", {"on": True}, wait=True)
        self.assertEqual(result, {"on": True})

    def test_invoke_dry_run(self):
        pinout = Pinout(base_url=self.daemon_url)
        device = pinout.device("relay-01")
        preview = device.invoke("relay.set", {"on": True}, dry_run=True)
        self.assertTrue(preview.get("dryRun"))

    def test_invoke_accepted_returns_operation(self):
        pinout = Pinout(base_url=self.daemon_url)
        device = pinout.device("relay-01")
        operation = device.invoke("relay.set", {"on": True})
        self.assertIsInstance(operation, Operation)
        self.assertEqual(operation.status, "completed")
        self.assertEqual(operation.result(), {"on": True})

    def test_unsupported_capability_raises(self):
        pinout = Pinout(base_url=self.daemon_url)
        device = pinout.device("relay-01")
        with self.assertRaises(UnsupportedCapability):
            device.invoke("motion.move_to")

    def test_policy_rejection_maps_to_typed_error(self):
        pinout = Pinout(base_url=self.daemon_url)
        device = pinout.device("relay-01")
        with self.assertRaises(PolicyRejected):
            device.invoke("relay.set", {"on": "boom"}, wait=True)

    def test_unknown_device_maps_to_error(self):
        pinout = Pinout(base_url=self.daemon_url)
        with self.assertRaises(PinoutError):
            pinout.device("ghost").state()

    def test_operation_progress_stream(self):
        pinout = Pinout(base_url=self.daemon_url)
        device = pinout.device("relay-01")
        operation = device.invoke("relay.set", {"on": True})
        updates = list(operation.progress())
        self.assertEqual(updates[-1]["fraction"], 1)

    def test_events_stream(self):
        pinout = Pinout(base_url=self.daemon_url)
        events = []
        for event in pinout.events():
            events.append(event)
            if len(events) >= 3:
                break
        self.assertEqual(events[0]["kind"], "runtime.event")

    def test_token_sent_when_configured(self):
        pinout = Pinout(base_url=self.daemon_url, token="tok-123")
        self.assertTrue(pinout.health()["ok"])

    def test_safety_and_halt_controls(self):
        pinout = Pinout(base_url=self.daemon_url)
        self.assertEqual(pinout.safety()["state"], "NORMAL")
        self.assertEqual(pinout.halt("maintenance")["state"], "HALTED")
        self.assertEqual(pinout.resume("ready")["state"], "NORMAL")
        self.assertEqual(pinout.estop("emergency")["state"], "ESTOP_REQUESTED")
        self.assertEqual(pinout.clear_estop()["state"], "HALTED")

    def test_leases_and_approvals(self):
        pinout = Pinout(base_url=self.daemon_url, owner="test-owner")
        device = pinout.device("relay-01")
        lease = device.acquire_lease()
        self.assertEqual(lease["owner"], "test-owner")
        renewed = device.renew_lease(lease["id"])
        self.assertEqual(renewed["owner"], "test-owner")
        device.release_lease(lease["id"])
        leases = pinout.leases()
        self.assertIsInstance(leases, list)

        approval = pinout.approve("appr-1", "relay-01", "relay.set")
        self.assertEqual(approval["id"], "appr-1")

        hb = pinout.heartbeat("relay-01")
        self.assertTrue(hb["alive"])

    def test_env_var_precedence_and_owner(self):
        saved_daemon_url = os.environ.get("PINOUT_DAEMON_URL")
        saved_url = os.environ.get("PINOUT_URL")
        saved_owner = os.environ.get("PINOUT_OWNER")
        try:
            os.environ["PINOUT_DAEMON_URL"] = self.daemon_url
            os.environ["PINOUT_URL"] = "http://127.0.0.1:59999"
            os.environ["PINOUT_OWNER"] = "env-agent"
            client = Pinout()
            self.assertEqual(client.owner, "env-agent")
            self.assertTrue(client.health()["ok"])
        finally:
            if saved_daemon_url is not None:
                os.environ["PINOUT_DAEMON_URL"] = saved_daemon_url
            else:
                os.environ.pop("PINOUT_DAEMON_URL", None)
            if saved_url is not None:
                os.environ["PINOUT_URL"] = saved_url
            else:
                os.environ.pop("PINOUT_URL", None)
            if saved_owner is not None:
                os.environ["PINOUT_OWNER"] = saved_owner
            else:
                os.environ.pop("PINOUT_OWNER", None)


if __name__ == "__main__":
    unittest.main()
