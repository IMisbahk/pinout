# ADR 0003: Bounded serial reset and handshake

Status: Accepted

Serial discovery may use DTR/RTS reset only when `resetOnConnect` is enabled by
the connection profile. The default is conservative: do not toggle reset lines
unless the caller opts in. Discovery sends a bounded `sys.hello` request and
accepts a valid protocol response before exposing a device.

This avoids surprise reboots on shared serial buses and prevents an open port
from being treated as a Pinout device without protocol evidence.

