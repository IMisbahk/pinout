# Security policy

Pinout can send commands to physical devices. Treat every backend and module as security-sensitive, even when the development default is a simulator.

## Supported versions

There is currently no published release line or long-term support commitment. Report against the latest commit and include the commit or package version you tested.

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability. Contact the repository maintainers privately through the contact route configured by the hosting platform, including:

- affected package, commit, or module;
- reproducible steps or a minimal proof of concept;
- impact, especially whether physical output, credentials, or module installation is involved;
- suggested mitigation, if known.

If no private maintainer route is available, open an issue requesting a security contact without including exploit details.

## Security boundaries

- The SDK validates structured inputs and known device rules; it does not validate wiring or guarantee physical safety.
- MCP exposes structured capabilities, but authorization, operator approval, network isolation, and emergency stop belong to the deployment.
- Modules execute code and must be reviewed before installation. Generated modules are candidates and are never trusted automatically.
- Keep serial/network credentials and private configuration outside source control. Use `.env` only for local development and rotate exposed secrets.
- Simulators are not a security or safety proof for real hardware.

## Disclosure expectations

Maintainers should acknowledge reports, reproduce them, coordinate a fix, and document affected versions when a supported release process exists. Until then, this file describes the intended reporting boundary rather than an SLA.
