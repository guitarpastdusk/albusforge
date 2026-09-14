// Shared fixture lifecycle tracking; production entry points never import it.
export { createTestDb, trackTestPool, closeTestPool, trackPoolShutdown } from "../../../packages/db/test/pool-shutdown.js";
