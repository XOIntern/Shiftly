import { PURGE_COVERAGE } from "./position-purge";
import { describePurgeCoverage } from "./test-purge-coverage";

describePurgeCoverage(
  "position purge coverage",
  PURGE_COVERAGE,
  "purgePositionGuarded",
);
