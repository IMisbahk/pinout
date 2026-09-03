# Company: Pinout

## Thesis

Physical systems are becoming programmable, but their control surfaces remain fragmented across board SDKs, serial protocols, vendor applications, and undocumented operational assumptions. Pinout is building the intelligence layer between software agents and those systems.

Pinout's thesis is simple: hardware should advertise what it can do, under which conditions, with which evidence, and through a stable interface that both a human developer and an agent can inspect.

## What we are building

Pinout is an open-source control-plane foundation with four responsibilities:

1. Normalize device behavior into semantic, typed capabilities.
2. Discover and operate multiple device instances through one runtime.
3. Enforce machine-checkable policy before physical output.
4. Make hardware integrations reproducible through modules, simulators, and provenance.

The current repository is the reference implementation and development surface. It is not evidence of customers, production deployments, certifications, or a complete hardware catalog.

## Who it is for

- Developers prototyping agentic hardware workflows.
- Robotics and lab teams that need a shared integration boundary.
- Module authors packaging vendor hardware for other applications.
- Platform teams evaluating a path from simulation to controlled deployment.

## Principles

Semantic over vendor-shaped; fail closed where software can; keep simulation visibly distinct from reality; make generated code reviewable; keep the core free of private service dependencies; and document what is deferred.
