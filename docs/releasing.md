# Releasing Pinout

The alpha release is a five-package npm surface: `@pinout/core`, `@pinout/cli`, `@pinout/daemon`, `@pinout/mcp`, and `@pinout/discovery`. Generator, module-host, and protocol packages are private implementation packages for this line. The Python client distribution is `pinout-client`; the module SDK remains `pinout-module` and is not part of the public alpha promise.

Release work is intentionally two-phase:

1. Build and inspect locally without registry access:

   ```sh
   npm ci
   npm run build
   npm run release:dry-run
   npm run docs:check
   python3 -m build --sdist --wheel sdk/python --outdir /tmp/pinout-python-dist
   ```

2. After deciding the canonical repository, npm scope, Python package ownership,
   and creating an approved signed tag, a maintainer may manually run
   `Prepare or publish v0.0.1-alpha`. Its `publish` input defaults to false.
   The publish job additionally requires the protected `alpha-release`
   environment and verifies that the supplied tag already exists at the
   workflow commit. Routine validation never publishes, creates a release, or
   creates a tag.

Every package has an explicit entrypoint/files allow-list and Node >=20 metadata. `npm pack --dry-run` is the artifact boundary; it is not a publication. Firmware artifacts are compile outputs only until a dated hardware record exists.
