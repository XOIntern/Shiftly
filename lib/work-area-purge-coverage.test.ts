import { PURGE_COVERAGE } from "./work-area-purge";
import { describePurgeCoverage } from "./test-purge-coverage";

describePurgeCoverage(
  "work area purge coverage",
  PURGE_COVERAGE,
  "purgeWorkAreaGuarded",
);
