# Engine Spatial Capabilities

This directory contains reusable, application-neutral spatial primitives.

## Current contents

- `grid-geometry.js` — pure validation and coordinate helpers for finite, square-topology grids with rectangular dimensions.

Grid geometry does not register a grid on a World, store cell contents, own entity placement, decide overlap legality, or implement gameplay rules.

## Ownership

- World Registry declares whether a World has the optional grid capability and owns its immutable dimensions.
- Grid Geometry validates and interprets that descriptor.
- Spatial Composition will own grid-backed contents, footprints and occupancy.
- Cassandra owns terrain, environment, passability, collision policy and movement behavior.
- Presentation consumes spatial state and never becomes its authority.

## Constraints

- Cell coordinates are safe integers with origin at the top-left; x increases right and y increases down.
- Bounds are half-open: `0 <= x < width`, `0 <= y < height`.
- Continuous world positions map to cells using floor semantics.
- A grid anchor maps to the center of its anchor cell at `(x + 0.5, y + 0.5)`.
- Neighbor queries do not wrap and return deterministic order.
- Non-grid Worlds remain valid and do not acquire grid behavior from generic dimensions alone.

See `docs/architecture/grid-geometry-contract-proposal.md` and `docs/architecture/phase-3-implementation-plan.md` for the full contract and implementation sequence.
