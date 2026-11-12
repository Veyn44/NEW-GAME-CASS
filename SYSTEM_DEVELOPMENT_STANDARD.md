# System Development Standard

**Applies to:** all host/gameplay systems added to NEW-GAME-CASS.  
**Does not authorize:** changes to archived Core or expansion of Core responsibilities.

## 1. Purpose

Every system must have a clear owner, a small public contract, explicit dependencies and tests that prove its behavior. A system is not complete merely because its source file exists or it registers successfully.

Use this standard proportionally: a small system should remain small. Do not create extra layers, services or abstractions without a concrete need.

## 2. Required system definition

Before implementation, document:

1. **System ID** — stable, namespaced identifier.
2. **Purpose** — one concise responsibility.
3. **Owned data** — exact state this system is authoritative for.
4. **Non-responsibilities** — what belongs elsewhere.
5. **Provided services** — public APIs and their input/output/error contracts.
6. **Required services** — exact Core or gameplay service IDs and why they are needed.
7. **Events published** — facts announced, with payload schema and version.
8. **Events consumed** — subscriptions and expected effects.
9. **Simulation behavior** — whether it has a synchronous update task, cadence and ordering assumptions.
10. **Lifecycle** — initialize/start/pause/resume/destroy behavior, including cleanup.
11. **Persistence** — snapshot schema, version, preparation, commit and rollback behavior, or an explicit reason persistence is not applicable.
12. **Tests** — unit, contract, integration and manual checks.
13. **Future extension points** — only real extension points, not speculative plugin systems.

## 3. Ownership and dependency rules

- One system is the authoritative owner of each piece of mutable domain state.
- Other systems use its public service API or consume its events; they do not write its private state.
- A system may depend only on declared public services.
- Avoid circular dependencies. If two systems need each other, identify the shared concept or orchestration boundary and redesign the contracts.
- Do not create a service that merely forwards every method of another system.
- Do not duplicate a Core capability in a gameplay system.
- Do not place game-specific fields in Core registries or Core contexts.
- Keep browser, DOM, keyboard, mouse and rendering APIs out of domain/simulation logic. Put them behind host adapters.
- Commands request an operation through a service API. Events report an operation that has already happened.

## 4. Core integration rules

- Register host systems explicitly through Core Assembly.
- Declare `id`, `provides` and `requires` exactly as the current Core API expects.
- Verify service IDs against `src/core/README.md` and the implementation; do not guess.
- Do not register systems as an import side effect.
- Use the Core lifecycle and cleanup contracts.
- Simulation tasks must obey the scheduler's synchronous fixed-step contract.
- Use Core Entity Registry for generic identity and lifecycle, not as a storage bucket for domain state.
- Use World Registry/World Context for world identity and exclusive placement, not for map generation or movement policy.
- Use Core Persistence as a transaction coordinator; each system serializes its own state.
- Use Core Logger for technical diagnostics. Game events are not automatically errors.

## 5. Public API design

A public API should:
- expose only operations and queries consumers need;
- validate arguments at the boundary;
- return documented values or stable, documented errors;
- avoid leaking mutable internal Maps, arrays or objects;
- avoid returning internal implementation objects;
- state whether an operation is synchronous;
- define identity semantics and whether an operation is idempotent;
- define event side effects, if any.

Prefer narrow methods over a generic mutation API. Avoid public setters that allow other systems to bypass invariants.

## 6. Lifecycle and failure behavior

For each lifecycle hook, document:
- what resources are acquired/released;
- what state transitions are allowed;
- what happens if the hook fails;
- which work must be rolled back or cleaned up;
- whether the system can be safely destroyed after partial initialization.

A system must not leave timers, subscriptions, input handlers or external resources active after destroy. It must not continue processing after its host lifecycle has ended.

## 7. Persistence rules

If the system owns durable game state:
- implement a persistence participant using the actual Core contract;
- use a stable participant ID and explicit schema version;
- keep snapshot data detached from mutable runtime objects;
- validate and prepare a restore before committing it;
- implement rollback so a failed restore cannot leave a partial state;
- add migration tests when the schema changes.

If the system owns no durable state, state that explicitly and explain why.

## 8. Simulation and events

- Simulation updates must be synchronous and deterministic for the same state and inputs under the same runtime conditions.
- Do not use arbitrary timers or frame callbacks inside gameplay systems.
- Keep input capture outside the simulation system; translate input into explicit requests.
- Do not mutate simulation state from a renderer.
- Emit events after the relevant state transition succeeds.
- Event payloads must be detached/immutable according to the Core Event Bus contract.
- Avoid event feedback loops and hidden command execution.

## 9. Required test layers

Every system must provide, as applicable:

| Test type | What it proves |
|---|---|
| Unit | Local rules, validation and state transitions |
| Public contract | Inputs, outputs, invalid requests and stable errors |
| Integration | Real interaction with declared Core/host services |
| Persistence | Snapshot, restore, migration and rollback |
| Simulation | Fixed-step behavior, pause behavior and deterministic outcomes |
| Manual | Visual/input behavior that automation does not cover |

Tests must verify both expected behavior and important forbidden behavior. A test suite that only checks happy paths is incomplete.

**Evidence rule:** a test is marked PASS only after it has actually run and passed. A prepared test is not a passing test. Report exact command, environment, count and result.

## 10. Definition of done

A system is ready for integration only when:
- [ ] its responsibility and data ownership are documented;
- [ ] public services and dependencies are documented and validated;
- [ ] lifecycle and failure cleanup are tested;
- [ ] persistence behavior is tested or explicitly marked not applicable;
- [ ] required automated tests pass;
- [ ] relevant integration tests pass;
- [ ] manual checks are recorded honestly;
- [ ] no hidden dependency or direct mutation of another system's data remains;
- [ ] documentation describes implemented behavior rather than planned behavior;
- [ ] the full active phase branch still passes regression tests.

## 11. System specification template

Copy and complete this block for each new system:

```md
# <System Name>

- **System ID:**
- **Status:** proposed | in progress | implemented | verified
- **Purpose:**
- **Owned data:**
- **Non-responsibilities:**

## Public services
| Service ID | Operations | Inputs/outputs/errors |
|---|---|---|

## Dependencies
| Required service | Provider | Reason |
|---|---|---|

## Events
| Direction | Event type + version | Payload | Meaning |
|---|---|---|---|

## Simulation
- Has update task:
- Cadence:
- Ordering assumptions:
- Pause behavior:

## Lifecycle
- initialize:
- start:
- pause/resume:
- destroy:
- Failure/rollback:

## Persistence
- Participant ID:
- Schema version:
- Snapshot:
- Restore preparation/commit:
- Rollback/migrations:

## Tests
- Unit:
- Contract:
- Integration:
- Persistence:
- Manual:
- Commands and verified results:

## Future extension points
-
```
