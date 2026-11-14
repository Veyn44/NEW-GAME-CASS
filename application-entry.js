import { loadCassandraDatabase } from "./cassandra/database/load-cassandra-database.js";
import { startDevLab } from "./dev-lab/application/application-shell.js";

// Temporary application composition root: Cassandra supplies content,
// while the Dev Lab application consumes only the generic Engine registry.
await startDevLab({ loadContentPackage: loadCassandraDatabase });
