# Cassandra Engine

A modular game-engine foundation with Cassandra as its first host application.

## Core

The reusable, domain-neutral runtime lives in [`src/core`](src/core/README.md). Host games provide their own systems and synchronous simulation tasks to the Core Assembly. Cassandra-specific demo wiring exists only in test fixtures.

## Development

Requires Node.js 20 or newer.

```sh
npm run test:core
```

The test runner executes the Core contract suites. A passing local run should be recorded only after actually running the command in the target environment.
