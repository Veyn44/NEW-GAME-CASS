import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const devLabShellUrl = new URL("../../dev-lab/application/application-shell.js", import.meta.url);
const devLabRuntimeUrl = new URL("../../dev-lab/application/create-dev-lab-runtime.js", import.meta.url);
const applicationEntryUrl = new URL("../../application-entry.js", import.meta.url);

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
  assert.doesNotMatch(source, /hostSystems\s*:/);
});
