# Next Steps and Development Roadmap

> Canonical working plan for the active repository. Verify the live repository and current tests before each implementation step. This document records the agreed direction; details marked **to design** are not yet implementation contracts.

## Project shape — agreed direction

One repository, one project and one Pages deployment. The project contains three cooperating parts with deliberately one-way dependencies:

1. **Engine** — the technology foundation. It must work without Cassandra and without Dev Lab. It owns reusable runtime mechanisms and general-purpose capabilities, not Cassandra's game rules or content. The engine does not require a visual interface to exist.
2. **Dev Lab** — the engine's development workspace. It uses the engine and provides the visual/editor/debugging environment for creating, inspecting and testing worlds, entities and data. It is not a separate game and must use the same engine/runtime systems as Cassandra. The engine must remain functional if Dev Lab is removed.
3. **Cassandra** — a separate game built on the engine. It owns its game rules, game-specific systems, content, database definitions, player-facing UI/HUD, presentation, audio and game experience. It depends on the engine; the engine must not depend on Cassandra.

The intended dependency direction is:

`Cassandra → Engine`
`Dev Lab → Engine`

Engine must not import or know about either Cassandra or Dev Lab. Dev Lab and Cassandra may both use the engine; neither is a prerequisite for the other.

### Removal test (architecture acceptance rule)

- Remove `cassandra/`: Engine and Dev Lab still work. Cassandra no longer exists.
- Remove `dev-lab/`: Engine and Cassandra still work. The engine simply loses its development workspace.
- Remove both: Engine remains a usable technology foundation, although there is no visual application/workspace.
- Remove `engine/`: Dev Lab and Cassandra cannot work.

These are dependency tests, not instructions to literally delete folders during development.

### Repository, branches and publishing

- Keep one Git repository: `Veyn44/NEW-GAME-CASS`.
- Target a simple branch model: stable `main` plus one working branch. No permanent per-component branches and no nested branch hierarchy.
- A working branch is not created automatically. **Before creating any branch, explain why it is needed and ask the user for permission.**
- Never merge to `main`, force-update a branch, delete a historical branch, or discard work without explicit user approval.
- One Pages deployment should publish the selected working branch and expose separate entry points for Dev Lab and Cassandra. A separate HTML entry point does not require a separate repository or branch.
- Verify the actual Pages configuration and workflow together before changing publishing. Do not infer the active Pages source from a workflow file alone.

## Agreed ownership boundaries

### Engine

- **Entity is the generic, indivisible engine concept.** The engine identifies, registers, places, renders/presents, persists and transfers entities through general contracts. It does not decide whether an entity is a wall, bullet, rock, grass, pawn, robot, boss, ship or base.
- Engine mechanisms for identity, world context, placement, persistence, database loading/validation and input/control infrastructure are reusable technology.
- Engine owns the general input/action registration mechanism. It can receive and route available actions; it does not decide the Cassandra meaning of a particular action or hard-code Cassandra's key bindings.
- Engine owns general pause behavior, camera behavior and the relationship between active input/control mode and camera behavior.
- Engine owns **Control Modes**: a general mechanism for changing the active interaction/control context, routing input appropriately, and taking/releasing control of an entity (possession). It must not know what a Pawn or Draft means in Cassandra.
- Engine must not contain domain-specific types or rules such as Cassandra Unit, Pawn, Colony Leader, Johny, Cassandra movement speed, eligibility rules or game objectives.

### Cassandra

- **Unit belongs to Cassandra.** A Cassandra Unit is a game-domain concept backed by a generic Engine Entity. Cassandra defines what a Unit is, its attributes, capabilities, movement and behavior.
- Cassandra owns its definitions and content data: Johny, pawns, materials, structures, items, weapons and other game-specific definitions.
- Cassandra defines concrete input actions, key bindings (for example F for Draft), their game meaning, conditions for transition into/out of a Control Mode, which entities are eligible for control, and the behavior of a controlled entity.
- Cassandra owns its game UI/HUD, menus, visual identity, sound, game loop composition and gameplay rules.

### Database

- The database **mechanism** belongs to Engine: registries, loading/import contracts, schemas, validation and definition/instance mechanics.
- Database **content and definitions** belong to the consuming game/content package. Cassandra supplies Cassandra-specific definitions.
- Dev Lab can inspect and work with loaded data packages. It must not be hard-wired to Cassandra's definitions; without Cassandra it can use a test package or an empty catalog.
- This boundary is agreed at the conceptual level. Exact schemas, package format, versioning and loading lifecycle are **to design** before implementation.

### Dev Lab

Dev Lab is the engine's own development workspace, not a separate gameplay implementation. It should provide the visual working surface and tools needed to inspect and test engine capabilities: world editing/preview, database inspection, entity creation/inspection, diagnostics and controlled test scenarios. It must compose the same runtime systems that Cassandra uses. Dev Lab-specific UI and debug controls stay outside Engine and Cassandra gameplay rules.

### Control Modes — agreed concept

Engine provides the generic mechanism:
- named/registered control modes and their lifecycle/transitions;
- input routing based on the active mode;
- general possession/release of an entity;
- camera behavior associated with the active mode;
- general pause/inspection behavior where applicable.

Cassandra provides:
- the actual game actions and their bindings;
- transition conditions and game-specific eligibility checks;
- what happens when an entity is controlled (movement, speed, abilities and rules);
- the meaning of actions such as Draft.

The exact mode list, public APIs, ownership of camera adapters, and pause/inspection interaction are **to design**. Do not assume a specific list of modes is already finalized.

## Development principles

1. Build for Cassandra's real needs; do not invent abstractions for hypothetical games.
2. Keep generic mechanisms in Engine and game-specific meaning/content in Cassandra.
3. Dev Lab tests the same runtime systems used by Cassandra; never create parallel Dev Lab-only gameplay implementations.
4. Keep Engine independent of both visual applications. Browser/DOM/rendering adapters must not leak into engine mechanisms that should run without a browser.
5. Preserve current working behavior while restructuring. Prefer small, reversible steps and mechanical moves before behavior changes.
6. Do not rewrite stable Core merely to make the folder layout look cleaner. Any Core change requires a demonstrated need, an explicit contract and focused regression coverage.
7. Keep automated test evidence distinct from manual browser acceptance. Never report a test as passed unless it was actually run.
8. Discuss and agree architectural decisions before implementing them. A roadmap proposal is not proof that its details have been approved.

## Roadmap — restructuring and development

### Phase 0 — Protect and establish the baseline

1. Keep the current `main` commit as the known rollback point.
2. Close/discard the obsolete Dev Lab entrypoint PR without merging it; separately remove its abandoned branch when repository tooling/permissions allow.
3. Inspect open PRs and existing branches. Do not merge or delete other historical work by assumption.
4. Run the current full automated suite and record exact results. The previously recorded baseline is Core 198/198; host/unit results have changed during later work and must be freshly verified.
5. Capture a current source tree, entry-point map, import/dependency map and test map.
6. Verify Pages source, workflow triggers and published artifact before changing deployment.

**Exit condition:** known baseline, known branch/Pages state, and a source/dependency map that identifies what currently belongs to each target area.

### Phase 1 — Define the target architecture before moving code

1. Agree the exact top-level structure and naming for `engine/`, `dev-lab/` and `cassandra/` (or an equivalent naming scheme).
2. Map every current file/module to its intended owner. Identify mixed modules and split responsibilities before moving them.
3. Define public boundaries and allowed dependencies. Engine imports no Dev Lab/Cassandra modules; Dev Lab and Cassandra import Engine; Cassandra-specific definitions are loaded as data.
4. Specify the generic Entity contract and distinguish it from Cassandra Unit.
5. Specify database mechanism vs. content package boundaries.
6. Specify the input/action registration contract and Control Modes contract, including possession, routing, camera and pause responsibilities.
7. Specify how Dev Lab and Cassandra each compose the same Engine runtime, and how each gets its own entry point.
8. Define migration/compatibility expectations for existing saves and database definitions before touching their formats.

**Exit condition:** user-approved architecture map, module ownership table, dependency rules and staged migration plan. No speculative implementation before this review.

### Phase 2 — Restructure the repository without changing behavior

1. Create the agreed top-level Engine, Dev Lab and Cassandra areas.
2. Move files in small logical groups; update imports and build/test paths.
3. Keep existing runtime behavior and data formats unchanged during the initial moves.
4. Separate browser/DOM presentation adapters from runtime and domain logic.
5. Remove accidental cross-layer imports and add dependency-boundary tests/lint checks where practical.
6. Run the full test suite after each coherent move and verify the application entry points.
7. Keep a clear mapping from old paths to new paths until migration is complete.

**Exit condition:** the same known features still work, tests pass, and the dependency direction is enforced. No feature redesign is hidden inside a file move.

### Phase 3 — Complete the Engine foundation from actual requirements

Implement or extract only what the source audit and Phase 1 contracts show is needed:

1. Generic Entity/world/placement/persistence contracts, extending the existing Core only where a concrete requirement demonstrates a gap.
2. Database mechanism in Engine, with data definitions supplied by content packages.
3. General input/action registration and routing.
4. Control Modes and possession, including camera-mode coordination and general pause behavior.
5. General presentation/rendering contracts and adapters where required, without making the engine depend on Dev Lab or Cassandra UI.
6. Focused unit, contract and integration tests for each capability.

**Important:** the current Core already has generic identity, world and persistence foundations. Do not replace them wholesale. Audit current behavior and preserve its tested contracts.

**Exit condition:** Engine can be composed and tested without importing either Dev Lab or Cassandra, and its public contracts are documented and covered.

### Phase 4 — Build Dev Lab as the Engine workspace

1. Compose the Engine through a Dev Lab host/application layer.
2. Provide the visual workspace, world editor/preview, database/package inspector, entity tools and diagnostics.
3. Support empty/test data packages and optional Cassandra data packages.
4. Add repeatable scenarios for testing Engine capabilities individually and together.
5. Ensure all simulation/gameplay mechanisms under test are the same implementations used by Cassandra.

**Exit condition:** removing Cassandra does not prevent Dev Lab from starting and exercising Engine with test/empty data.

### Phase 5 — Rebuild Cassandra as an independent game host

1. Create the Cassandra application entry point and player-facing UI/HUD.
2. Add Cassandra-specific content and database packages.
3. Implement Unit and other Cassandra domain concepts on top of generic Engine Entities.
4. Register Cassandra actions and bindings; use Engine Control Modes for Draft/possession and other control contexts.
5. Implement Cassandra-specific movement, attributes, eligibility, rules, presentation and audio.
6. Verify Cassandra does not import Dev Lab code and can run without the Dev Lab workspace.

**Exit condition:** Cassandra runs as a game using Engine, while Dev Lab remains an optional separate development application.

### Phase 6 — Single Pages deployment and acceptance

1. Publish the one repository/working branch as one Pages artifact.
2. Expose distinct Dev Lab and Cassandra routes/entry points from that same deployment.
3. Verify direct URL loading, refresh/deep links, asset paths and browser console.
4. Run automated CI and manual acceptance for both applications.
5. Verify the removal tests/dependency graph and save/load compatibility.

**Exit condition:** one deployment serves both applications; neither app is accidentally bootstrapped by the other's entry point.

### Phase 7 — Audit, corrections and stable milestone

1. Perform the large architecture audit: Argon, layer boundaries, duplicate/misplaced code, dead code, test quality, runtime/browser issues, persistence and performance.
2. Fix findings in small, separately verifiable changes.
3. Re-run CI and manual acceptance.
4. Record limitations and deferred work.
5. Archive only after all accepted fixes are integrated and verified.

## Explicit non-goals for this restructuring

- Do not build a universal framework for hypothetical game genres.
- Do not add Cassandra gameplay rules to Engine.
- Do not make Dev Lab a prerequisite for Engine or Cassandra.
- Do not make Cassandra a prerequisite for Engine or Dev Lab.
- Do not redesign the world/grid/multi-occupancy model by assumption; settle it in the relevant design step.
- Do not implement AI, combat, inventory, crafting, colony automation or cross-world transfer merely because they may be future game features.
- Cross-world unit transfer remains deferred to a later phase unless the user explicitly reopens it.
- Do not change save formats, persistence semantics or the tested Core simulation behavior as an incidental consequence of restructuring.

## Current execution status

- [x] One repository / Engine + Dev Lab + Cassandra dependency direction agreed.
- [x] Generic Engine Entity vs. Cassandra Unit boundary agreed.
- [x] Database mechanism in Engine vs. game data in Cassandra agreed.
- [x] General input/action registration in Engine vs. concrete game actions in Cassandra agreed.
- [x] General Engine Control Modes and Cassandra-defined transition rules agreed.
- [x] No new branch without explaining the reason and obtaining user permission.
- [x] Obsolete PR #5 closed without merging.
- [ ] Delete the abandoned PR #5 branch (not yet completed).
- [ ] Refresh test baseline and inspect the live repository/Pages state.
- [ ] Agree exact folder layout and module ownership map.
- [ ] Approve Phase 1 architecture and migration sequence.
- [ ] Begin Phase 2 mechanical restructuring.

## Technical commands and references

Requires Node.js 20 or newer:
- `npm run test:core`
- `npm run test:host`
- `npm run test:all`

Read the current source and tests before relying on any old phase-specific contract. The Core and Host README files describe the current baseline, but source code and tests remain authoritative.
