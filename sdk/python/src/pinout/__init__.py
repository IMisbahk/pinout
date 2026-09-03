"""Pinout Python SDK.

Talks to a running ``pinoutd`` daemon over its local HTTP API. The sync client
uses only the standard library; install the ``async`` extra for the asyncio
client::

    pip install pinout[async]

Example::

    from pinout import Pinout

    p = Pinout()
    arm = p.device("arm-01")
    arm.invoke("motion.home")

Long-running capabilities return an :class:`Operation` you can await, poll,
stream progress from, or cancel safely.
"""

from .client import Device, Operation, Pinout, PinoutError
from .errors import (
    LeaseConflict,
    OperationFailed,
    PolicyRejected,
    SafetyHalted,
    Timeout,
    Unauthorized,
    UnsupportedCapability,
)

__all__ = [
    "Device",
    "Operation",
    "Pinout",
    "PinoutError",
    "LeaseConflict",
    "OperationFailed",
    "PolicyRejected",
    "SafetyHalted",
    "Timeout",
    "Unauthorized",
    "UnsupportedCapability",
]
__version__ = "0.1.0"
