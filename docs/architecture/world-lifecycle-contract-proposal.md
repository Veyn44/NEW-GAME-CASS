# World Lifecycle Contract — Proposal

**Status:** Proposal for review — not an implementation specification  
**Scope:** Engine Core world lifecycle, simulation participation, time, failure isolation and persistence  
**Branch:** `work`  
**Last source audit:** 2026-11-15

This document translates the reviewed architectural direction into a concrete contract proposal. It does not authorize source-code changes. Terms marked **Proposed** remain subject to review.

## 1. Purpose

Engine Core must support multiple registered worlds without assuming that only one world can exist, be loaded, or participate in simulation at a time.

The Engine provides neutral lifecycle and simulation mechanisms. The host application decides which worlds to create, load, simulate, pause, focus, render, unload or dispose, and why.

Examples:
- Cassandra may keep its Main World loaded but stop its simulation while a Temporary World runs an expedition.
- Dev Lab may keep several test worlds loaded and choose independently which ones receive simulation steps.
- Neither host-specific policy belongs in Engine Core.

## 2. Vocabulary and independent dimensions

These concepts must not be collapsed into one `status` field.

### 2.1 Registration / existence

Owned by World Registry.

- **Unregistered:** no descriptor exists in the registry.
- **Registered:** a stable world identity and descriptor exist.
- **Closed:** the registered identity has been closed and cannot be activated or loaded again under the same identity.

Registration does not imply that world data is loaded, that it is ready, or that it is being simulated.

### 2.2 Data readiness

Proposed runtime lifecycle:

- **Unloaded:** no live world data/runtime instance is currently resident.
- **Loading:** the host has begun loading or constructing the world.
- **Ready:** required world data and runtime services are available.
- **Disposing:** runtime teardown is in progress.
- **Disposed:** the current runtime instance has been torn down. The registered identity may remain if the host intends to load it again; disposal is not deletion of persistent data.

A load failure must not silently produce a Ready world. The host receives a failure result and decides whether to retry, discard, or close the world.

### 2.3 Simulation participation

Independent of readiness and focus:

- **Enabled:** the host has authorized the world to receive simulation steps.
- **Disabled:** the world receives no simulation steps.

A world must be Ready before participation can be enabled. Disabling participation does not unload, deactivate, delete, or reset the world.

The Engine must not infer participation from registration, activation, focus, visibility, or rendering.

### 2.4 Pause

Pause is a reasoned restriction, not a replacement for the lifecycle state.

A world can be Ready and simulation-enabled while paused by one or more reasons. Removing one reason must not remove unrelated pause reasons. The host owns the meaning of host-specific reasons; Core owns only generic pause mechanics.

A disabled world does not need an additional pause reason merely to explain why it is not receiving steps.

### 2.5 Focus / selection

Focus is host-level selection, not a world lifecycle status.

- A host may have zero or one focused world in a single-focus interface.
- Focus does not enable simulation.
- Losing focus does not disable simulation.
- A focused world need not be the only loaded or simulated world.

If a host supports multiple viewports or panels, it may maintain multiple presentation selections without changing the simulation contract.

### 2.6 Rendering

Rendering is presentation owned by the host/application, not by Engine Core world simulation.

- A world may be rendered without receiving simulation steps.
- A world may receive simulation steps without being rendered.
- Rendering or hiding a world must not implicitly change its simulation participation.

## 3. Allowed lifecycle transitions

The following is the proposed runtime transition contract.

| Current state | Operation | Result |
|---|---|---|
| Unloaded | Begin load | Loading |
| Loading | Load succeeds | Ready |
| Loading | Load fails | Unloaded or explicit Failed result; no Ready state |
| Ready | Begin unload | Disposing, then Unloaded |
| Ready | Dispose runtime | Disposing, then Disposed |
| Disposed | Load again | Loading, if identity remains registered and host permits it |
| Any runtime state | Close identity | Only after runtime is safely stopped and released; then registry becomes Closed |

Rules:
- Loading, unloading and disposal are explicit operations; they are not side effects of focus changes.
- A world cannot receive simulation steps while Unloaded, Loading, Disposing or Disposed.
- A world cannot be disposed while it is executing a simulation step.
- Closing a world identity must not implicitly delete host-owned persistent data. Data deletion is a separate host decision.
- Invalid transitions return stable, diagnosable errors and do not partially mutate lifecycle state.

## 4. Time and simulation contract

### 4.1 One global time base

Retain one shared Engine Game Clock as the authoritative time-conversion and speed source. Do not introduce independent wall clocks or independent per-world time scaling in this design slice.

The global scheduler produces deterministic fixed simulation steps. A host decides which Ready worlds participate in each step.

### 4.2 Per-world simulated time

Each world has a persisted **world simulated time** value: the total simulation time successfully committed for that world.

- It advances only when that world completes a simulation step successfully.
- A disabled or paused world receives no step and its simulated time does not advance.
- A different world's progress does not age this world.
- The value is simulation accounting, not a second clock that advances independently in the background.

World simulation systems must receive the world's local simulation time in their step context. They must not use the global clock as a substitute for elapsed time in that world.

### 4.3 Global time commit

The global clock remains the shared timeline for the runtime. It advances according to completed global fixed-step processing, not rendering or wall-clock passage alone.

A successful step for one world may advance the global timeline while another world is disabled. The disabled world's local simulated time remains unchanged.

If no world participates, the host may allow the runtime's global clock to remain idle; Core must not invent world simulation merely to advance a clock.

### 4.4 Fixed-step and determinism

- Preserve fixed-step execution and deterministic ordering.
- A **global simulation round** is one fixed-step interval on the shared scheduler timeline.
- At the beginning of each round, the scheduler takes an immutable snapshot of the worlds that are Ready, enabled and not paused. That participant set cannot change partway through the round; lifecycle or participation changes requested during execution take effect at the next round boundary.
- Every participating world receives at most one world-scoped step for that global round. A world that is not in the participant snapshot receives no step.
- World iteration order must be independent of focus, rendering, registration order and incidental collection iteration. The proposed canonical order is ascending world ID using a locale-independent ordinal string comparison. Do not rely on the current WorldRegistry list locale-based sort as a cross-runtime determinism guarantee.
- Within each world, simulation systems retain the dependency order validated by SystemRegistry/Bootstrap. Do not introduce a second dependency graph.
- The exact interleaving of global (non-world-scoped) tasks and world-scoped tasks must be specified by the scheduler contract before the public task API is implemented; it must not be left to incidental array order.
- A world's local simulated time is committed only at the defined successful round boundary. The global clock advances once per completed global round, not once per participating world.
- The first multi-world implementation must not claim world-local fault isolation unless it can prove the required state-commit boundary. Until then, preserve the current fail-stop behavior described below.
- The global scheduler's existing backlog, speed-snapshot, bounded catch-up and overload semantics must be preserved unless a separately reviewed design explicitly changes them.
- Rendering frequency must not affect simulation time.

## 5. Failure isolation

Proposed failure domains:

### 5.1 World-local failure — future capability, not assumed in the first multi-world slice

A future scheduler may isolate a failure to one world only when:
- the failure is attributable to that world's simulation work rather than shared infrastructure;
- the failed world's partial mutations cannot corrupt another world's state or shared state;
- the failed world can be stopped at a safe boundary;
- the scheduler can account for successful and failed world work without advancing time inconsistently;
- diagnostics identify the world, global round/tick and failing system/task;
- the host receives an explicit recovery decision.

A failed world step must not advance that world's committed simulated time.

**Current limitation:** the synchronous task model does not provide automatic rollback of mutations made earlier in a partially executed step. A world can mutate state before a later task throws. Therefore, do not simply continue with other worlds and claim isolation unless a reviewed commit/rollback boundary proves that doing so is safe. A failed world may require restoring a prior snapshot or rebuilding its runtime.

**Initial multi-world safety rule:** until that boundary exists and is covered by tests, any simulation-task failure continues to fault and pause the global scheduler, exactly as it does today. This deliberately postpones per-world fault isolation rather than weakening existing failure safety.
### 5.2 Shared infrastructure failure

Failures in shared infrastructure (for example, a corrupted shared event bus, global clock or scheduler invariant) may stop the complete runtime. The Engine must not misclassify a shared failure as an isolated world failure.

### 5.3 Existing behavior to preserve during transition

Today, any task failure faults the single global SimulationScheduler, leaves the failed fixed-step round uncommitted, and adds the global scheduler-fault pause reason. This behavior must remain intact for the first multi-world scheduling implementation. Multi-world support must not silently change it into best-effort continuation. Per-world fault isolation is a later capability requiring an explicit safe commit/rollback design and dedicated tests.
## 6. Focus, rendering and host policy

Engine Core does not decide:
- which world the player sees;
- whether Main World pauses during an encounter;
- whether an encounter world is temporary;
- whether Dev Lab runs multiple test worlds simultaneously;
- when to autosave, unload, dispose or delete host data.

The host supplies explicit lifecycle and participation commands. Focus and rendering remain independent of those commands.

## 7. Persistence and restore

### 7.1 Persistent data

The save model must be able to restore:
- registered world identities and descriptors;
- each world's domain-owned state through its owning persistence participants;
- each world's committed simulated-time value;
- any additional stable lifecycle metadata required to reconstruct a Ready runtime safely.

### 7.2 Runtime-only state

Do not blindly restore transient runtime flags such as:
- currently executing;
- loading in progress;
- disposing in progress;
- focused;
- currently rendered;
- active simulation task invocation.

These are reconstructed or selected by the host after restore.

### 7.3 Safe restore default

After a save is loaded:
- world data may be restored and worlds may be prepared as Ready;
- simulation participation defaults to Disabled;
- no world automatically begins simulating merely because it was active before saving;
- focus and rendering are selected by the host;
- the host explicitly authorizes simulation after its own initialization and validation are complete.

A partially restored or failed world must not receive simulation steps.

### 7.4 Transactional restore

Preserve the existing prepare/commit/rollback persistence model. World lifecycle state must participate in restore without leaving the runtime half-restored if a participant fails.

## 8. Host examples

### Cassandra: expedition

1. Main World is Ready and simulation-enabled.
2. Cassandra creates/loads a Temporary World.
3. Cassandra disables Main World simulation.
4. Temporary World becomes Ready and simulation-enabled; Cassandra focuses/renders it.
5. During the expedition, only Temporary World's local simulated time advances.
6. Cassandra resolves expedition results and applies persistent changes according to game rules.
7. Cassandra disables and disposes Temporary World.
8. Cassandra enables Main World simulation and selects it for focus/rendering.

Engine does not know the words Main World, expedition, encounter, or colony.

### Dev Lab: test worlds

1. Dev Lab registers and loads several test worlds.
2. It enables simulation independently for whichever worlds it wants to test.
3. It may focus/render one world while other worlds continue simulating.
4. It may stop, unload, reload or dispose a test world without changing the others, unless a shared infrastructure failure occurs.

## 9. Acceptance scenarios

These are proposed minimum acceptance tests before implementation is considered complete.

1. Register several worlds without implicitly loading or simulating them.
2. Load two worlds; both can remain Ready simultaneously.
3. Enable simulation for World B while World A remains Ready but disabled.
4. Advance several fixed steps; only World B's local simulated time increases.
5. Enable both worlds; both receive one world-scoped step per global round in canonical world-ID order, and each local time advances by one fixed-step duration.
6. Register the same worlds in a different order; the execution order remains identical.
7. Request a participation or lifecycle change during a round; the immutable participant set remains unchanged until the next round boundary.
8. Focus World A while World B continues simulating; focus does not change participation.
9. Render neither world while one or both continue simulating; rendering does not change time.
10. Disable World B; its local time remains unchanged while World A continues.
11. Pause World B for one reason, remove a different pause reason, and confirm World B remains paused until its own reason is removed.
12. Cause a task failure in a multi-world round; the initial implementation faults and pauses the global scheduler, does not commit the global round, and does not claim that earlier world mutations were rolled back.
13. Cause a shared scheduler/infrastructure failure; the runtime stops according to global safety rules.
14. Attempt simulation while a world is Unloaded, Loading, Disposing or Disposed; the operation is rejected.
15. Unload and reload a registered world; its persistent data and committed simulated time are restored.
16. Keep two persistent colony worlds loaded and enabled across many rounds; both continue to receive deterministic steps without requiring focus to switch between them.
17. Save while both colony worlds are loaded; restore both worlds and their local simulated times, with participation disabled until the host explicitly enables them.
18. Fail a persistence participant during restore; prior committed runtime state is rolled back where supported.
19. Dispose a temporary world; its runtime resources are released without silently deleting host-owned persistent data.
20. Confirm current single-world scheduler determinism, backlog, pause, overload and fault regression tests remain passing.

## 10. Explicitly out of scope

This contract does not design or implement:
- Cassandra universe/galaxy maps, expeditions, combat or encounter rules;
- grid geometry, occupancy, pathfinding, collision or physical world composition;
- rendering, camera, input routing or UI;
- cross-application save compatibility;
- independent per-world clocks or independent time scaling;
- automatic rollback of arbitrary host-system mutations during a failed simulation step;
- a specific class/file layout or migration implementation.

## 11. Current implementation facts and required migration caution

Source audit on work confirms:
- WorldRegistry supports multiple registered descriptors, but activeWorldId is singular; activating another world deactivates the previous one.
- WorldRegistry.list() returns descriptors sorted with localeCompare. That is deterministic within a given runtime configuration, but it is not by itself a cross-locale canonical ordering contract.
- GameClock is one global clock with one global set of pause reasons and one committed totalSeconds value.
- SimulationScheduler is global, executes its task list synchronously in the dependency order supplied by Core Assembly, and commits one global clock step only after all tasks in that step complete.
- Scheduler task failure faults and globally pauses the scheduler; it does not roll back mutations made by tasks that ran earlier in the failed step.
- CoreAssembly currently supplies one global list of simulationTasks; task callbacks receive a global step context and the Core service context, not a world-scoped execution context.
- WorldContext stores entity placement, not world runtime lifecycle or per-world simulation time.
- World Registry snapshots persist world descriptors and the single active-world reference; they do not persist world runtime readiness, participation or local simulated time.
- Persistence already supports participant snapshots, migration, and transactional prepare/commit/rollback for participating state.

Therefore, multi-world simulation requires a staged scheduler/task-context and persistence extension. It must not be implemented by merely allowing multiple registry entries to have status active, by iterating a mutable world list during a step, or by adding unrelated booleans without transition validation.

## 12. Review status

**Agreed direction:**
- one shared global time base;
- independent per-world simulation participation;
- paused worlds do not accumulate simulated time;
- focus/rendering are independent from simulation;
- host applications own world policy;
- shared infrastructure failures may stop the runtime.

**Proposal still requiring review:**
- exact public API and runtime-state representation;
- exact division and ordering of global tasks versus world-scoped tasks within one global round;
- how the scheduler atomically commits per-world local time alongside the single global time value;
- whether a failed world step is recoverable only by restore/rebuild or may gain transactional rollback later;
- exact restore readiness sequence and snapshot schema;
- lifecycle transition error codes and event/diagnostic names.

No source-code implementation is authorized by this document.
