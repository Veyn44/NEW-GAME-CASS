# Cassandra Engine

A modular game-engine foundation with Cassandra as its first host application.

## Core

Core baseline history and current Cassandra integration status: [CORE_MIGRATION_STATUS.md](CORE_MIGRATION_STATUS.md).

The reusable, domain-neutral runtime lives in [`src/core`](src/core/README.md). Host games provide their own systems and synchronous simulation tasks to the Core Assembly. Cassandra-specific demo wiring exists only in test fixtures.

## Development documentation

The phase plans, architecture, system standards and test procedures are indexed in [docs/README.md](docs/README.md). Phase 2 is complete and merged into `main`; its original `next-step/phase-2` branch is retained pending a separate cleanup decision. The accepted Phase 3 working scope is documented in [docs/phases/PHASE_3.md](docs/phases/PHASE_3.md).

## Development

Requires Node.js 20 or newer.

```sh
npm run test:core
```

The test runner executes the Core contract suites. A passing local run should be recorded only after actually running the command in the target environment.
