import { loadCassandraDatabase } from "../../cassandra/database/load-cassandra-database.js";
import { startDevLab } from "./application-shell.js";

// Register the existing Cassandra-owned definitions as content only.
// The standalone Dev Lab still starts its own generic Engine runtime.
await startDevLab({ loadContentPackage: loadCassandraDatabase });
