import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const devLabShellUrl = new URL("../../dev-lab/application/application-shell.js", import.meta.url);
const applicationEntryUrl = new URL("../../application-entry.js", import.meta.url);

test("Dev Lab application does not import or load Cassandra content directly", async () => {
  const source = await readFile(devLabShellUrl, "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*cassandra\//);
  assert.doesNotMatch(source, /loadCassandraDatabase\s*\(/);
  assert.match(source, /export async function startDevLab\(/);
});

test("the application composition root supplies Cassandra content to Dev Lab", async () => {
  const source = await readFile(applicationEntryUrl, "utf8");
  assert.match(source, /loadCassandraDatabase/);
  assert.match(source, /startDevLab\(\{\s*loadContentPackage:\s*loadCassandraDatabase\s*\}\)/);
});
