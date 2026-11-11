import { runClockSchedulerTests } from "./clock-scheduler.test.js";
import { runCoreRegistryTests } from "./core-registry.test.js";
import { runEntityRegistryTests } from "./entity-registry.test.js";
import { runEventBusTests } from "./event-bus.test.js";
import { runLifecycleBootstrapTests } from "./lifecycle-bootstrap.test.js";
import { runPersistenceLoggerTests } from "./persistence-logger.test.js";
import { runWorldRegistryTests } from "./world-registry.test.js";
import { runWorldContextTests } from "./world-context.test.js";
import { runCoreIntegrationTests } from "./core-integration.test.js";

const suites = [
  ["Clock + Scheduler", runClockSchedulerTests],
  ["Core Registry", runCoreRegistryTests],
  ["Entity Registry", runEntityRegistryTests],
  ["Event Bus", runEventBusTests],
  ["Lifecycle + Bootstrap", runLifecycleBootstrapTests],
  ["Persistence + Logger", runPersistenceLoggerTests],
  ["World Registry", runWorldRegistryTests],
  ["World Context", runWorldContextTests],
  ["Core Integration", runCoreIntegrationTests]
];
let passed = 0;
let failed = 0;
for (const [name, run] of suites) {
  const results = await run();
  const suitePassed = results.filter((item) => item.passed).length;
  const suiteFailed = results.length - suitePassed;
  passed += suitePassed;
  failed += suiteFailed;
  console.log(`\n${name}: ${suitePassed}/${results.length}`);
  for (const item of results.filter((entry) => !entry.passed)) {
    console.error(`FAIL ${item.name}: ${item.error ?? "unknown failure"}`);
  }
}
console.log(`\nCORE TEST RESULT: ${passed}/${passed + failed} passed; ${failed} failed`);
if (failed > 0) process.exitCode = 1;
