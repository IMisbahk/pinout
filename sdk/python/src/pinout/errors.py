"""Typed errors for the Pinout Python SDK.

Applications branch on ``error.code`` / the exception class — never on
English prose.
"""


class PinoutError(Exception):
    """Base class for all SDK errors."""

    def __init__(self, message: str, *, code: str = "INTERNAL_ERROR", category: str = "DEVICE",
                 retryable: bool = False, details: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.category = category
        self.retryable = retryable
        self.details = details or {}

    @classmethod
    def from_payload(cls, payload: dict) -> "PinoutError":
        """Build the most specific error from a daemon error envelope."""
        error = payload.get("error", {})
        code = error.get("code", "INTERNAL_ERROR")
        message = error.get("message", str(payload))
        category = error.get("category", "DEVICE")
        retryable = bool(error.get("retryable", False))
        details = error.get("details")

        specific = _CODE_MAP.get(code)
        if specific is None:
            specific = _CATEGORY_MAP.get(category, cls)
        return specific(message, code=code, category=category, retryable=retryable, details=details)


class UnsupportedCapability(PinoutError):
    """The device does not expose the requested capability."""


class PolicyRejected(PinoutError):
    """A policy or safety rule rejected the invocation."""


class SafetyHalted(PolicyRejected):
    """The runtime is halted / estop-requested / faulted."""


class LeaseConflict(PinoutError):
    """Another owner holds a conflicting lease."""


class OperationFailed(PinoutError):
    """An operation reached a failed terminal state."""


class Timeout(PinoutError):
    """A deadline elapsed waiting for the device or daemon."""


class Unauthorized(PinoutError):
    """Missing or invalid bearer token."""


_CATEGORY_MAP = {
    "POLICY": PolicyRejected,
    "SAFETY": SafetyHalted,
    "LEASE": LeaseConflict,
    "AUTH": Unauthorized,
    "TIMEOUT": Timeout,
}

_CODE_MAP = {
    "UNSUPPORTED_CAPABILITY": UnsupportedCapability,
    "SAFETY_HALTED": SafetyHalted,
    "SAFETY_ESTOP_REQUESTED": SafetyHalted,
    "SAFETY_FAULTED": SafetyHalted,
    "SAFETY_LEASE_REQUIRED": LeaseConflict,
    "LEASE_CONFLICT": LeaseConflict,
    "OPERATION_FAILED": OperationFailed,
    "OPERATION_TIMEOUT": Timeout,
    "TIMEOUT": Timeout,
    "AUTH_REQUIRED": Unauthorized,
}
