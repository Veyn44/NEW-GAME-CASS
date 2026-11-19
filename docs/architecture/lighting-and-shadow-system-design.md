# Lighting and Shadow System — Design Proposal

> Status: approved direction for design and staged implementation; detailed runtime contracts remain subject to implementation tests and Dev Lab feedback.
> Scope: reusable 2D lighting data, illumination, occlusion and shadow calculations, plus application presentation integration.
> Target branch: `phase4`.

## 1. Goals

Build a reusable lighting capability that can be tested and tuned live in Dev Lab and consumed by Cassandra without Cassandra-specific rules in Engine.

Primary requirements:

- Light definitions and instances are data-driven; changing a parameter must not require changing the lighting algorithm.
- Dev Lab and Cassandra use the same runtime calculations. Dev Lab must not contain a parallel lighting implementation.
- Runtime tuning is supported: add, move, enable/disable and edit lights while a world is running.
- Support multiple lights, overlapping illumination, walls/doors/obstacles, static and moving sources, and later larger maps.
- Keep illumination separate from game visibility, Fog of War and AI perception.
- Preserve existing grid, spatial composition, world and viewport contracts.

## 2. Ownership boundaries

### Engine

Engine owns application-neutral lighting mechanisms and contracts:

- Light instance lifecycle and validation.
- Light type parameters and normalized runtime configuration.
- Illumination calculations and distance attenuation.
- Occlusion queries against a host-supplied world-geometry interface.
- Shadow/visibility calculations that answer geometric questions (which cells/positions are occluded from a source).
- Dirty-region/invalidation contracts and reusable calculation caches where justified.

Engine does not own Canvas, DOM, browser APIs, game UI, Cassandra content, Fog of War state, Pawn vision rules, enemy visibility rules, or the final artistic presentation.

### Presentation (shared initially; may evolve later)

The existing shared viewport/presentation layer consumes Engine lighting results and draws them. It owns Canvas-specific rendering, compositing, gradients, blur/softness, visual color treatment and viewport integration.

This is intentional: current repository architecture explicitly keeps browser rendering outside Engine Core. Do not move Canvas or DOM code into Engine merely to implement lighting.

### Cassandra

Cassandra owns:

- Which objects are light sources and their game-specific definitions.
- Day/night, power state, fuel, damage and switching rules.
- Pawn vision range/angle and perception rules.
- Fog of War states: never explored, currently visible, previously explored.
- Which entities are currently disclosed to the player.

### Dev Lab

Dev Lab owns the editor/inspector UI and developer workflows. It uses the same Engine APIs as Cassandra and the same shared presentation path. It may expose extra debug visualizations, but must not implement its own light propagation or shadow algorithm.

## 3. Light model

Use a common base configuration plus a type-specific parameter object. Do not create a separate hard-coded implementation for every lamp/item.

Common fields (initial proposal):

- `id`: stable instance ID.
- `type`: `point`, `spot`, `area` or `ambient`.
- `position`: world-space position; grid worlds may use cell-centered positions.
- `enabled`: boolean.
- `intensity`: non-negative normalized/scalar strength (exact scale to be finalized with renderer calibration).
- `color`: RGB color data.
- `radius`: finite range for local lights; not used by global ambient.
- `falloff`: fixed to `quadratic`; no linear mode is implemented or planned in the current design.
- `innerRadius`: optional unattenuated near-field radius, smaller than `radius`. This supports sources such as a flashlight that remain bright nearby before fading toward their outer range.
- `castsShadows`: boolean.
- `shadowStrength`: 0..1.
- `metadata`: optional detached application-neutral JSON-like extension data; never interpreted by Engine.

Type-specific parameters:

- Point: no additional required geometry.
- Spot: direction, inner angle and outer angle.
- Area: width/height or a documented shape; initially may be approximated by a bounded set of samples.
- Ambient: global or explicitly bounded region, with no point-source shadow casting by default.

An emissive object is not a separate propagation algorithm. It is an application/content object that can register or drive one or more ordinary light instances. This avoids duplicating the light model.

Do not silently clamp malformed data into plausible values. Validate IDs, finite coordinates, finite non-negative intensity/radius, color shape/range, angles and type-specific fields. Return stable, actionable errors.

## 4. Calculation model

### First implementation target

Use the existing square grid as the first occlusion adapter, not as a hard-coded limitation of the public lighting model.

- A host-supplied occlusion query reports whether a cell/segment blocks light and, if needed later, a transmission value.
- Engine calculates which cells/positions are reached by each local source and the geometric shadow/occlusion result.
- Distance attenuation is calculated independently of the renderer and uses one quadratic curve only. Between `innerRadius` and `radius`, attenuation is `(1 - t)²`, where `t = (distance - innerRadius) / (radius - innerRadius)`. Inside `innerRadius` strength remains unchanged; at or beyond `radius` it is zero.
- Spot lights additionally filter by direction and cone angles.
- Contributions from multiple lights are accumulated into a detached illumination result.
- Ambient contribution is applied separately from local lights.

The initial grid algorithm should favor deterministic, testable shadow casting. Evaluate symmetric shadowcasting (or an equivalent deterministic grid occlusion algorithm) for tile visibility. Keep the algorithm behind a replaceable strategy boundary so a later continuous-world implementation does not change light definitions or Cassandra APIs.

### Important separation

Illumination is not visibility:

- A bright cell does not automatically become visible to the player.
- A dark cell may still be visible at close range if Cassandra's vision rules allow it.
- Engine reports illumination and geometric occlusion facts.
- Cassandra combines those facts with Pawn vision and game rules to decide current visibility.
- Fog of War stores exploration history and is not part of the lighting runtime.

A wall may block direct light and direct line of sight, but those are separate queries/policies. Do not assume every visual obstacle has identical behavior for light and Pawn vision.

## 5. Shadows

Separate geometric occlusion from visual shadow styling.

Engine answers whether a source has an unobstructed path to a target and provides the resulting illumination/occlusion data. Presentation decides how hard or soft the shadow looks, how it is composited, and how it is colored.

The first version should support hard grid occlusion by blocking cells. Soft shadows, penumbra, area-light sampling and decorative object shadows are later refinements, not prerequisites for correct point-light behavior.

## 6. Runtime API shape (proposal)

Keep the API small and data-oriented. Candidate surface:

- `createLightingSystem({ occlusionQuery, ...options })`
- `addLight(lightDefinition)`
- `updateLight(lightId, patch)`
- `removeLight(lightId)`
- `getLight(lightId)`
- `listLights({ worldId })`
- `calculateIllumination({ worldId, bounds })`
- `invalidateRegion({ worldId, bounds, reason })`

The initial implementation is registered as `core.lighting` through Core Assembly. It exposes `addLight`, `updateLight`, `removeLight`, `getLight`, `listLights` and `calculateIllumination`. Reads return immutable detached data. `occlusionQuery` is supplied by the host and must be synchronous.

Light instances are world-scoped. A light in one world must never affect another world, including temporary encounter worlds. Moving a light, changing an occluder, changing its configuration or changing world geometry invalidates only the affected calculation region where practical.

## 7. Performance and invalidation

Do not recompute every light over the whole world on every frame.

Initial correctness comes first; then profile before adding complexity. The design should allow:

- Restricting work to a source's radius and requested viewport/region.
- Reusing results for static lights and unchanged occluders.
- Separating static and dynamic sources.
- Invalidating regions when a light or relevant blocker changes.
- Batching illumination queries for a region rather than querying one tile at a time.
- Deterministic results independent of render frame rate.

Do not introduce GPU/WebGL dependencies or premature chunking before measured need.

## 8. Dev Lab requirements

The Lighting Inspector should eventually support:

- Add Point / Spot / Area / Ambient light.
- Select and move a light in the viewport.
- Enable/disable and remove it.
- Edit common and type-specific fields live.
- Toggle shadow casting and show debug occlusion.
- Inspect per-cell illumination values and overlapping contributions.
- Save/load presets and export/import definitions.
- Reset to known test scenes.

Edits must go through the same runtime API as game content. The inspector must not mutate private service state or directly draw its own lighting result.

A small set of deterministic test scenes should cover: isolated point light, two overlapping lights, wall occlusion, doorway, spot cone, ambient-only scene, disabled light, moving light and world isolation.

## 9. Proposed implementation sequence

1. Audit existing Engine service registration, world identity, grid geometry, spatial composition and shared viewport contracts.
2. Finalize light data schema, validation, world-scoped instance lifecycle and occlusion adapter.
3. Implement and unit-test deterministic point-light illumination and hard grid occlusion, without Canvas.
4. Add ambient and spot lights; defer area-light visual softness until the base is stable.
5. Add shared viewport presentation/compositing consuming calculated illumination.
6. Add Dev Lab Lighting Inspector and deterministic test scenes.
7. Profile 128×128 and 256×256 worlds; optimize only measured bottlenecks.
8. Integrate Cassandra light sources and then Cassandra Vision/Fog of War as separate systems.

## 10. Initial implementation status\n\n- `engine/lighting/lighting-system.js` contains a world-scoped point-light registry and deterministic grid line-occlusion calculation.\n- Quadratic attenuation is the only supported falloff. `innerRadius` provides a bright near-field plateau; `radius` is the zero-intensity boundary.\n- Light instances are runtime-only and are not registered as Persistence participants. Cassandra owns restoring sources from game definitions (decision A).\n- Core Assembly exposes the service as `core.lighting`; the host injects a synchronous `lightingOcclusionQuery`.\n- Initial tests cover quadratic falloff, hard occlusion, world isolation, enable/disable, update/remove, invalid definitions, immutable snapshots and bounded queries.\n- Current implementation supports `point` only. Spot/area/ambient and Canvas rendering remain future steps.\n\n## 11. Acceptance criteria

- Engine lighting modules import no Cassandra, Dev Lab, DOM or Canvas modules.
- The same light definitions and calculations are used in Cassandra and Dev Lab.
- A point light illuminates cells within its range and attenuates deterministically with distance.
- A blocking wall prevents direct illumination behind it; removing/opening the blocker updates the result.
- Multiple light contributions combine predictably.
- Disabled/removed lights stop contributing immediately.
- Two worlds remain isolated.
- Changing a light through the public API updates the result without restarting the world.
- Invalid configurations fail explicitly.
- Existing spatial, viewport, world lifecycle and persistence tests remain unchanged/passing.
- No Fog of War or Pawn visibility rule is embedded in Engine lighting.
