# Protocol v1 golden vectors

Each line in `messages.jsonl` is a complete NDJSON frame. Vectors are the
wire contract shared by the TypeScript host, simulator, and firmware bridge.
Unknown/non-JSON boot logging is intentionally outside the vectors and must be
ignored by hosts.
