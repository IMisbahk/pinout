"""Executable contract smoke test against a live local pinoutd."""

from __future__ import annotations

import os

from pinout import Pinout


def main() -> None:
    client = Pinout(base_url=os.environ["PINOUT_TEST_URL"], token=os.environ["PINOUT_TEST_TOKEN"])
    assert client.health()["ok"] is True
    device = client.device("relay-python")
    lease = device.acquire_lease("python-contract")
    preview = device.invoke(
        "relay.set", {"on": True}, owner="python-contract", dry_run=True
    )
    assert preview["dryRun"] is True
    result = device.invoke(
        "relay.set", {"on": True}, owner="python-contract", wait=True
    )
    assert result == {"on": True}
    device.release_lease(lease["id"], "python-contract")


if __name__ == "__main__":
    main()
