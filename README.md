# Cassandra — Game and Universal 2D Engine

Cassandra is the first game project through which we are building and validating a reusable **universal 2D engine**. The Engine should remain useful beyond Cassandra; Cassandra's game rules and content stay in its own layer.

## Project memory

- [Current Cassandra Game Concept](GAME_CONCEPT.md) — authoritative creative baseline for the current world, premise, opening mission and gameplay direction.
- [Next Steps and Development Handoff](NEXT_STEPS.md) — project status, workflow and engineering handoff.
- [Project History](PROJECT_HISTORY.md) — verified milestones, implementation outcomes and archival record.
- [Cassandra Vision Index](CASSANDRA_VISION.md) — concise entry point and earlier prototype/presentation notes.

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
