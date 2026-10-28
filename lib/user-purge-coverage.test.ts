import { PURGE_COVERAGE } from "./user-purge";
import { describePurgeCoverage } from "./test-purge-coverage";

describePurgeCoverage(
  "user purge coverage",
  PURGE_COVERAGE,
  "purgeUserGuarded",
);
