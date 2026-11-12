# Cassandra Engine

A modular game-engine foundation with Cassandra as its first host application.

## Core

Current migration scope, verified test baseline and remaining Phase 1 work: [CORE_MIGRATION_STATUS.md](CORE_MIGRATION_STATUS.md).

The reusable, domain-neutral runtime lives in [`src/core`](src/core/README.md). Host games provide their own systems and synchronous simulation tasks to the Core Assembly. Cassandra-specific demo wiring exists only in test fixtures.

## Development documentation

The active phase plan, architecture, system standards and test procedures are indexed in [docs/README.md](docs/README.md). Phase work is developed and verified on its `next-step/` branch before an explicitly approved merge into `main`.

## Development

Requires Node.js 20 or newer.

```sh
npm run test:core
```

The test runner executes the Core contract suites. A passing local run should be recorded only after actually running the command in the target environment.
