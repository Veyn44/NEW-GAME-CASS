# Cassandra Engine

A modular game-engine foundation with Cassandra as its first host application.

## Core

Core baseline history and current Cassandra integration status: [CORE_MIGRATION_STATUS.md](CORE_MIGRATION_STATUS.md).

The reusable, domain-neutral runtime lives in [`src/core`](src/core/README.md). Cassandra's host runtime and gameplay systems live outside Core and compose it through its public contracts. Core owns generic runtime infrastructure; Cassandra owns Unit/Pawn, world/gameplay rules, presentation and host integration.

## Development documentation

The phase plans, architecture, system standards and test procedures are indexed in [docs/README.md](docs/README.md). Phase 2 is complete and merged into `main`; its original `next-step/phase-2` branch is retained pending a separate cleanup decision. The accepted Phase 3 working scope is documented in [docs/phases/PHASE_3.md](docs/phases/PHASE_3.md).

## Development

Requires Node.js 20 or newer.

```sh
npm run test:core
npm run test:host
npm run test:all
```

`test:core` runs the Core regression suite, `test:host` runs the host/gameplay unit tests, and `test:all` runs both. A passing local run should be recorded only after actually running the command in the target environment.
