import { PURGE_COVERAGE } from "./shift-purge";
import { describePurgeCoverage } from "./test-purge-coverage";

describePurgeCoverage(
  "shift purge coverage",
  PURGE_COVERAGE,
  "purgeShiftGuarded",
);
