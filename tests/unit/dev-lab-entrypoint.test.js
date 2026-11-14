import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Cassandra landing page does not load Dev Lab presentation or runtime modules", async () => {
  const html = await readProjectFile("index.html");

  assert.match(html, /href="\.\/dev-lab\.html"/);
  assert.doesNotMatch(html, /dev-world-preview\.css/);
  assert.doesNotMatch(html, /src\/dev-lab\//);
  assert.doesNotMatch(html, /application-shell\.js/);
  assert.doesNotMatch(html, /world-canvas/);
  assert.match(html, /dev-lab\.html\?view=settings/);
  assert.match(html, /dev-lab\.html\?view=database/);
});

test("Dev Lab has its own page and explicit entrypoint", async () => {
  const html = await readProjectFile("dev-lab.html");
  const entrypoint = await readProjectFile("src/dev-lab/dev-lab-entrypoint.js");

  assert.match(html, /dev-world-preview\.css/);
  assert.match(html, /src="\.\/src\/dev-lab\/dev-lab-entrypoint\.js"/);
  assert.match(entrypoint, /import "\.\/dev-lab-controller\.js"/);
});

test("Dev Lab controller uses the shared runtime and gameplay systems", async () => {
  const controller = await readProjectFile("src/dev-lab/dev-lab-controller.js");

  assert.match(controller, /createGameRuntime/);
  assert.match(controller, /createUnitSystem/);
  assert.match(controller, /createGameInputSystem/);
  assert.match(controller, /createColonyControlSystem/);
  assert.match(controller, /startDevLabRuntime\(\);/);
  assert.match(controller, /showView\("dev-lab"\);/);
  assert.match(controller, /requestedView === "database"/);
  assert.match(controller, /requestedView === "settings"/);
  assert.doesNotMatch(controller, /src\/core\//);
});
