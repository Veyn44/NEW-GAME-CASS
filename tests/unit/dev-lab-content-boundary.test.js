import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Dev Lab shell has no Cassandra or game-system imports", async () => {
  const source = await read("../../dev-lab/application/application-shell.js");
  assert.equal(source.includes("/cassandra/"), false);
  assert.equal(source.includes("/src/gameplay/"), false);
  assert.equal(source.includes("createUnitSystem"), false);
  assert.equal(source.includes("createColonyControlSystem"), false);
  assert.ok(source.includes("createRuntime = createDevLabRuntime"));
  assert.ok(source.includes("export async function startDevLab("));
});

test("Cassandra composition root owns game systems and adapts them to Dev Lab", async () => {
  const source = await read("../../cassandra/application/cassandra-application-shell.js");
  assert.ok(source.includes("createUnitSystem"));
  assert.ok(source.includes("createColonyControlSystem"));
  assert.ok(source.includes("createInputSystem"));
  assert.ok(source.includes("export function createCassandraRuntime"));
  assert.ok(source.includes("export function resolveCassandraRuntimeServices"));
  assert.ok(source.includes("export async function startCassandraApplication"));
  assert.ok(source.includes("createRuntime: createCassandraRuntime"));
  assert.ok(source.includes("resolveRuntimeServices: resolveCassandraRuntimeServices"));
});

test("Cassandra browser entry delegates to the Cassandra application shell", async () => {
  const source = await read("../../application-entry.js");
  assert.ok(source.includes("cassandra-application-shell"));
  assert.ok(source.includes("startCassandraApplication"));
  assert.equal(source.includes("createUnitSystem"), false);
  assert.equal(source.includes("startDevLab"), false);
});

test("standalone Dev Lab entry and page do not load Cassandra application code", async () => {
  const entry = await read("../../dev-lab/application/standalone-entry.js");
  const html = await read("../../dev-lab.html");
  assert.ok(entry.includes('from "./application-shell.js"'));
  assert.ok(entry.includes("await startDevLab()"));
  assert.equal(entry.toLowerCase().includes("cassandra/"), false);
  assert.ok(html.includes("standalone-entry.js"));
  assert.ok(html.includes('data-view="dev-lab"'));
  assert.equal(html.includes("application-entry.js"), false);
  assert.equal(html.toLowerCase().includes("cassandra/"), false);
});

test("Dev Lab has a standalone Engine runtime without Cassandra gameplay imports", async () => {
  const source = await read("../../dev-lab/application/create-dev-lab-runtime.js");
  assert.ok(source.includes("createGameRuntime"));
  assert.ok(source.includes('systemId: "dev-lab.free-camera"'));
  assert.equal(source.includes("/src/gameplay/"), false);
  assert.equal(source.includes("/cassandra/"), false);
});

test("Dev Lab shell consumes a gameplay adapter instead of Cassandra Unit/Colony APIs", async () => {
  const source = await read("../../dev-lab/application/application-shell.js");
  assert.ok(source.includes("gameplayApi"));
  assert.equal(source.includes("pawn.johny"), false);
  assert.equal(source.includes("game.unit-api"), false);
  assert.equal(source.includes("game.colony-control-api"), false);
});

test("Cassandra gameplay adapter owns Draft binding and Pawn-specific placement policy", async () => {
  const source = await read("../../cassandra/application/dev-lab-gameplay-controller.js");
  assert.ok(source.includes("KeyF"));
  assert.ok(source.includes("pawn.johny"));
  assert.ok(source.includes("toggleDraft"));
});

test("Cassandra application exposes a single gameplay adapter contract to Dev Lab", async () => {
  const source = await read("../../cassandra/application/cassandra-application-shell.js");
  assert.ok(source.includes("createCassandraDevLabGameplayController"));
  assert.ok(source.includes("gameplayApi"));
  const resolver = source.slice(source.indexOf("export function resolveCassandraRuntimeServices"));
  assert.ok(resolver.includes("gameplayApi"));
  assert.equal(/^\s{4}(?:unitApi|colonyControlApi|inputApi):/m.test(resolver), false);
});

test("Dev Lab delegates Unit inspection UI and contains no Cassandra inspector markup", async () => {
  const source = await read("../../dev-lab/application/application-shell.js");
  assert.ok(source.includes("gameplayUi"));
  assert.ok(source.includes("inspectGameplayEntity"));
  for (const forbidden of ["quickSelect", "unitProfile", "quick-select", "unit-profile", "selectedUnitId", "selectedObject"]) {
    assert.equal(source.includes(forbidden), false);
  }
  const entry = await read("../../cassandra/application/cassandra-application-shell.js");
  assert.ok(entry.includes("createCassandraDevLabUnitInspectorUi"));
  assert.ok(entry.includes("gameplayUi"));
  const ui = await read("../../cassandra/application/dev-lab-unit-inspector-ui.js");
  assert.ok(ui.includes('data-role="quick-select"'));
  assert.ok(ui.includes('data-role="unit-profile"'));
  assert.ok(ui.includes("getSelectedUnitId"));
  assert.ok(ui.includes("isProfileOpen"));
});
