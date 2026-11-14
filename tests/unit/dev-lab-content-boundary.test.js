import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const devLabShellUrl = new URL("../../dev-lab/application/application-shell.js", import.meta.url);
const devLabRuntimeUrl = new URL("../../dev-lab/application/create-dev-lab-runtime.js", import.meta.url);
const applicationEntryUrl = new URL("../../application-entry.js", import.meta.url);
const cassandraGameplayUrl = new URL("../../cassandra/application/dev-lab-gameplay-controller.js", import.meta.url);

test("Dev Lab shell does not import or compose Cassandra gameplay systems", async () => {
  const source = await readFile(devLabShellUrl, "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*cassandra\//);
  assert.doesNotMatch(source, /from\s+["'][^"']*src\/gameplay\//);
  assert.doesNotMatch(source, /createUnitSystem|createColonyControlSystem|createInputSystem/);
  assert.doesNotMatch(source, /game\.(?:unit-api|colony-control-api)/);
  assert.match(source, /createRuntime\s*=\s*createDevLabRuntime/);
  assert.match(source, /resolveRuntimeServices/);
  assert.match(source, /export async function startDevLab\(/);
});

test("the Cassandra composition root supplies gameplay runtime and service resolution", async () => {
  const source = await readFile(applicationEntryUrl, "utf8");
  assert.match(source, /createUnitSystem/);
  assert.match(source, /createColonyControlSystem/);
  assert.match(source, /createInputSystem/);
  assert.match(source, /export function createCassandraRuntime/);
  assert.match(source, /export function resolveCassandraRuntimeServices/);
  assert.match(source, /createRuntime:\s*createCassandraRuntime/);
  assert.match(source, /resolveRuntimeServices:\s*resolveCassandraRuntimeServices/);
});

test("Dev Lab has a standalone Engine runtime without Cassandra gameplay imports", async () => {
  const source = await readFile(devLabRuntimeUrl, "utf8");
  assert.match(source, /createGameRuntime/);
  assert.match(source, /systemId:\s*["']dev-lab\.free-camera["']/);
  assert.doesNotMatch(source, /src\/gameplay\/|cassandra\//);
  assert.match(source, /hostSystems:\s*\[\s*\{\s*id:\s*["']dev-lab\.free-camera["']/);
});

test("Dev Lab shell consumes a gameplay adapter instead of Cassandra Unit/Colony APIs", async () => {
  const source = await readFile(devLabShellUrl, "utf8");
  assert.match(source, /gameplayApi/);
  assert.doesNotMatch(source, /state\.(?:unitApi|colonyControlApi|inputApi)/);
  assert.doesNotMatch(source, /game\.(?:unit-api|colony-control-api)/);
  assert.doesNotMatch(source, /pawn\.johny|KeyF|spawnableAs\.includes\(["']unit["']\)/);
});

test("Cassandra gameplay adapter owns Draft binding and Pawn-specific placement policy", async () => {
  const source = await readFile(cassandraGameplayUrl, "utf8");
  assert.match(source, /KeyF/);
  assert.match(source, /pawn\.johny/);
  assert.match(source, /toggleDraft/);
  assert.match(source, /createCassandraDevLabGameplayController/);
});

test("Cassandra application exposes a single gameplay adapter contract to Dev Lab", async () => {
  const source = await readFile(applicationEntryUrl, "utf8");
  assert.match(source, /createCassandraDevLabGameplayController/);
  assert.match(source, /gameplayApi:/);
  const resolver = source.slice(source.indexOf("export function resolveCassandraRuntimeServices"));
  assert.match(resolver, /gameplayApi:/);
  assert.doesNotMatch(resolver, /^\s*(?:unitApi|colonyControlApi|inputApi):/m);
});
