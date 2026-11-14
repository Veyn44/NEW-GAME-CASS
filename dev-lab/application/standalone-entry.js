import { startDevLab } from "./application-shell.js";

// Standalone Dev Lab uses only its own host shell and the generic Engine runtime.
// No Cassandra content package, gameplay systems, or application shell is loaded.
await startDevLab();
