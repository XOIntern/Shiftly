import { PURGE_COVERAGE } from "./worker-purge";
import { describePurgeCoverage } from "./test-purge-coverage";

describePurgeCoverage(
  "worker purge coverage",
  PURGE_COVERAGE,
  "purgeWorkerGuarded",
);
