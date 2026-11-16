# World Lifecycle Contract

> **Post-merge verification status (2026-11-16):** The implementation was merged into `main` through PR #7. Exact merge-commit Core/Host CI passed in [run 43940567950](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43940567950). Remaining browser/host acceptance is tracked separately in [phase-3-manual-acceptance-checklist.md](phase-3-manual-acceptance-checklist.md) and [current-implementation-status.md](current-implementation-status.md).

**Status:** Initial deterministic multi-world contract implemented and merged; selected real-browser lifecycle/acceptance checks remain open.  
**Scope:** Engine Core world lifecycle, simulation participation, time, failure isolation and persistence  
**Integrated branch:** `main`  
**Last source audit:** 2026-11-16

This document records the agreed contract and implemented baseline. It does not claim that every host/browser acceptance scenario has been executed.

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

### 2.7 Ownership of runtime state

The existing World Registry remains the owner of persistent world identity and descriptors. The Engine-owned `WorldRuntimeManager` maintains a separate runtime lifecycle/simulation state record for each registered world. Its responsibilities are limited to:
- tracking the runtime state (Unloaded, Loading, Ready, Disposing, Disposed);
- tracking whether simulation participation is enabled;
- tracking independent pause reasons;
- owning the committed per-world simulated time and completed-step counter;
- supplying the scheduler's immutable participant snapshot.

The Engine `WorldRuntimeManager` does not load map contents, create domain systems, own rendering, or decide host policy. The host performs the actual load/build/teardown work and reports successful or failed lifecycle transitions to the service. A world cannot become Ready until the host confirms its required data and runtime services are prepared.

Do not add these fields to the existing World descriptor. Registration/selection and runtime residency are separate lifecycles.
## 3. Allowed lifecycle transitions

The following is the runtime transition contract implemented by `WorldRuntimeManager`.

| Current state | Operation | Result |
|---|---|---|
| Unloaded | Begin load | Loading |
| Loading | Load succeeds | Ready |
| Loading | Load fails | Unloaded or explicit Failed result; no Ready state |
| Ready | Begin unload | Disposing, then Unloaded |
| Ready | Dispose runtime | Disposing, then Disposed |
| Loading | Dispose partial runtime | Disposing, then Disposed |
| Unloaded | Dispose runtime | Disposing, then Disposed |
| Disposed | Load again | Loading, if identity remains registered and host permits it |
| Any runtime state | Close identity | Only after runtime is safely stopped and released; then registry becomes Closed |

Rules:
- Loading, unloading and disposal are explicit operations; they are not side effects of focus changes.
- A world cannot receive simulation steps while Unloaded, Loading, Disposing or Disposed.
- Lifecycle transitions are rejected while a simulation round is executing; teardown cannot begin mid-step.
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
- World iteration order must be independent of focus, rendering, registration order and incidental collection iteration. The canonical order is ascending world ID using a locale-independent ordinal string comparison. Do not rely on the current WorldRegistry list locale-based sort as a cross-runtime determinism guarantee.
- Within each world, simulation systems retain the dependency order validated by SystemRegistry/Bootstrap. Do not introduce a second dependency graph.
- The exact interleaving of global (non-world-scoped) tasks and world-scoped tasks must be specified by the scheduler contract before the public task API is implemented; it must not be left to incidental array order.
- A world's local simulated time is committed only at the defined successful round boundary. The global clock advances once per completed global round, not once per participating world.
- The first multi-world implementation must not claim world-local fault isolation unless it can prove the required state-commit boundary. Until then, preserve the current fail-stop behavior described below.
- The global scheduler's existing backlog, speed-snapshot, bounded catch-up and overload semantics must be preserved unless a separately reviewed design explicitly changes them.
- Rendering frequency must not affect simulation time.

### 4.5 Task scope and execution order

The scheduler keeps one ordered simulation-task sequence and gives each task an explicit execution scope:

- **Global task:** executes once per global simulation round.
- **World task:** executes once for each world in that round's immutable participant snapshot.
- Existing tasks default to Global scope so current hosts retain their present behavior until they explicitly opt into world-scoped execution.
- Tasks continue to follow the single dependency order validated by SystemRegistry/Bootstrap. Do not create a second dependency graph or separate unordered global/world task arrays.
- The scheduler walks tasks in dependency order. A Global task runs once at its position. A World task runs for each participant in canonical ascending world-ID order before the scheduler advances to the next task. This defines the interleaving rather than relying on array grouping or host iteration order.
- Existing global tasks retain global-tick frequency semantics. A World task's `everyTicks` frequency is evaluated against that world's own completed-step counter, not the global tick, so a paused world does not lose local cadence while other worlds advance.
- A World task receives both the global round context and an immutable world context containing at least world ID, next local step number, current local simulated time and the proposed post-step local time. The existing global `tick` and global time fields remain global; world-local fields must be named distinctly.
- If no world participates, no simulation round is run: neither global nor world simulation tasks execute and the global simulation clock does not advance. Host maintenance that must run without simulated worlds is not a simulation task.

### 4.6 Round commit boundary

After every scheduled task in the round has completed successfully:

1. Validate the proposed next global time and every participant's next local time and step counter before mutating any clock state.
2. Commit the global clock once and each participating world's local simulated time and completed-step counter once, in one synchronous commit section with no callbacks or event delivery between assignments.
3. Only after the complete commit may the scheduler publish the completed-round result/diagnostics.

If validation or any task fails, no global or per-world time value is committed for that round. The current global scheduler fail-stop rule applies. This does not roll back domain mutations already made by tasks; the runtime remains faulted and must not resume as if the round were clean.

The commit boundary is an Engine contract, not a requirement that arbitrary domain state be transactionally copied. The first implementation should use prevalidated, non-throwing state assignments for the time counters and should fault the runtime if an invariant is violated.


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

### 6.1 Compatibility with the existing World Registry active selection

The current `WorldRegistry` has a singular `activeWorldId` and `active/inactive/closed` descriptor status. Existing Cassandra systems use this as the current gameplay/control world: Colony Control checks that the leader is placed in the active world, and Cassandra World Session uses it to select which world's local time receives the current step.

Do not reinterpret `activeWorldId` as loaded, Ready, simulation-enabled, or focused. Do not make multiple descriptors active as a shortcut to multi-world simulation. Preserve its existing single-selection behavior for compatibility. The new runtime lifecycle and simulation participation state must be separate, and the Engine scheduler must select participants from that runtime state rather than from `activeWorldId`.

This also means focus may often follow the active gameplay world in a host UI, but the two concepts are not the same contract and must not be coupled in Engine Core.


## 7. Persistence and restore

### 7.1 Persistent data

The save model must be able to restore:
- registered world identities and descriptors;
- each world's domain-owned state through its owning persistence participants;
- each world's committed simulated-time value and completed-step counter;
- any additional stable lifecycle metadata required to reconstruct a Ready runtime safely.

The per-world time and completed-step counter belong to the Engine runtime simulation-state participant, not to a Cassandra-specific session system. A completed-step counter is persisted because World-task cadence is based on local steps and must survive save/restore without depending on another world's global tick count.

### 7.2 Runtime-only state

Do not blindly restore transient runtime flags such as:
- currently executing;
- Loading or Disposing in progress;
- Ready (it must be re-established by the host after runtime reconstruction);
- simulation participation enabled;
- pause reasons;
- focused;
- currently rendered;
- active simulation task invocation.

The existing World Registry's `activeWorldId` remains a separate persisted host/gameplay selection for compatibility; restoring it must not imply Ready state or simulation participation.

### 7.3 Safe restore default and ordering

After a save is loaded:
- world descriptors and domain-owned persistent state are restored transactionally by their persistence participants;
- Engine per-world committed time and completed-step counters are restored;
- all runtime lifecycle records begin Unloaded, with participation Disabled and no transient pause reasons;
- the host reconstructs each desired world runtime and explicitly reports successful readiness;
- the host explicitly enables simulation only after its own initialization and validation are complete;
- focus and rendering are selected independently by the host.

A partially restored or failed world must not receive simulation steps. Persistence restore itself does not load map data or mark worlds Ready.

### 7.4 Transactional restore

Preserve the existing prepare/commit/rollback persistence model. The Engine runtime simulation-state participant must validate that every saved world-time record references a registered, non-closed world and that time/counter values are finite and non-negative. Restore must not leave a partially replaced time table if a later participant fails.

Lifecycle runtime records are reconstructed after persistence restore; they are not partially committed by the save transaction.
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

These are the minimum acceptance scenarios for the complete contract; the current Core implementation and regression coverage are summarized in Section 11.

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
14. Attempt simulation while a world is Unloaded, Loading, Disposing or Disposed; it receives no simulation steps.
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
- parallel/multithreaded execution of world tasks.

## 11. Implementation status on `work`

The initial deterministic multi-world implementation is now present in the working branch.

### 11.1 Engine runtime lifecycle

- `engine/core/world-runtime-manager.js` exports `WorldRuntimeManager` and `WorldRuntimeError`; Core Assembly publishes it as `core.world-runtime`.
- The manager owns each registered world's runtime state, participation flag, independent pause-reason set, committed local simulated time and completed-step counter. It does not change `WorldRegistry.activeWorldId`.
- Public lifecycle operations are `beginLoading`, `markReady`, `failLoading`, `beginUnload`, `finishUnload`, `beginDisposal` and `finishDisposal`.
- Participation and pause operations are `setSimulationEnabled`, `pause` and `resume`.
- The scheduler uses immutable participant snapshots. Participation changes made during a task affect the next round; lifecycle teardown/loading transitions are rejected while a round is executing.
- Unloaded, Loading, Disposing and Disposed worlds cannot participate. Disposed identities may be loaded again while the World Registry descriptor remains registered.

### 11.2 Scheduler and time

- Simulation tasks now accept `scope: "global"` or `scope: "world"`; omitted scope remains Global for task compatibility.
- Both scopes remain in the single dependency-ordered task sequence supplied by SystemBootstrap.
- A World task is invoked in ascending ordinal world-ID order for each participant and receives an immutable `world` context with world ID, local completed-step count, next local step and local simulated time.
- Global task frequency remains based on the global tick. World task `everyTicks` frequency is based on that world's local completed-step counter.
- If no world participates, Core Assembly runs no simulation round, executes no simulation tasks and clears the simulation backlog rather than accumulating time for later replay.
- The scheduler validates global and local time counters before commit. It commits the one global Game Clock step and every participant's local time/step counter only after all tasks complete.
- Any task failure still faults and globally pauses the scheduler. Domain mutations made earlier in the failed round are not rolled back; per-world fault isolation remains out of scope.

### 11.3 Persistence and host migration

- Core Assembly registers `core.world-runtime` as a required save participant at order `-85`, between World Registry (`-90`) and composite spatial placement (`-80`).
- New saves must contain the runtime snapshot. For backward compatibility, a missing runtime snapshot in an older save invokes an explicit restore transaction that reconstructs registered worlds as Unloaded and simulation-disabled.
- Cassandra's `CassandraWorldSessionSystem` now reads local time from Engine runtime state; it no longer owns a live `worldTimes` map or advances a second local clock from a host simulation task.
- Cassandra retains a compatibility copy of local times in its session snapshot solely to migrate saves written before `core.world-runtime` existed. The Engine participant is the source of truth for current saves.
- Cassandra host policy enables the selected Main or Temporary World and disables the other. Its application explicitly re-establishes the selected runtime after loading a save.
- Dev Lab registers and prepares its editor world before enabling its simulation-scoped host task.

### 11.4 Verification

The latest CI run for this implementation slice completed successfully:
- Core: 230/230
- Host/Unit: 260/260
- Browser entry-point syntax checks: passed
- Workflow: https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43832633971

The CI result is not a substitute for launching the actual Pages/browser application. Host-level manual verification remains outstanding.

## 12. Review status

**Agreed direction:**
- one shared global time base;
- independent per-world simulation participation;
- paused worlds do not accumulate simulated time;
- focus/rendering are independent from simulation;
- host applications own world policy;
- shared infrastructure failures may stop the runtime.

**Implemented and covered by CI:**
- Engine runtime lifecycle service and separate runtime-state ownership;
- Global/World task scopes in one deterministic dependency order;
- local per-world cadence and shared global time commit;
- immutable participant snapshots and lifecycle boundary guards;
- per-world time persistence, restore defaults and legacy-save compatibility;
- Cassandra local-time migration and host participation policy;
- two-world integration and single-world regression tests.

**Still intentionally deferred:**
- per-world failure isolation or rollback of arbitrary world/domain mutations;
- parallel or multithreaded simulation;
- Cassandra product policy for multiple persistent colonies (the Engine capability does not require Cassandra to enable it);
- browser/Pages verification by the project owner.

### 12.1 Remaining verification and future work

1. Launch Cassandra and Dev Lab through the actual Pages/browser entry points; verify startup, pause/resume, save/load and selected-world behavior.
2. Keep the existing global fail-stop rule until a separate design proves safe world-local failure isolation and rollback/rebuild semantics.
3. Treat parallel execution as a future optimization. The current contract guarantees deterministic multi-world simulation, not concurrent CPU execution.
4. If Cassandra later supports several persistent colonies, define its host policy and UI separately; no Engine API redesign should be necessary.

The implementation has been merged into `main` through PR #7. Remaining browser/Pages acceptance is tracked separately; see the post-merge status note at the top of this document.
