# Cassandra — Universal 2D Engine Development

Cassandra is the first game project through which we are building and validating our own **universal 2D engine**. The engine should remain useful beyond Cassandra; Cassandra's game rules and content stay in its own layer.

## Project memory

- [Next Steps and Development Handoff](NEXT_STEPS.md) — current direction, workflow and what to do next. Read this first when resuming work.
- [Project History](PROJECT_HISTORY.md) — verified milestones, implementation outcomes and archival record.
- [Cassandra Vision](CASSANDRA_VISION.md) — game-specific ideas and design inspiration, not an engine specification.

## Runtime documentation

- [Core runtime API and responsibilities](engine/core/README.md)
- [Host runtime API and responsibilities](engine/runtime/README.md)

## Development

Requires Node.js 20 or newer.

```sh
npm run test:core
npm run test:host
npm run test:all
```

Dev Lab is a development/testing environment for real reusable systems. It may be hidden or omitted from a final player-facing build, but it is a central tool during engine development.
