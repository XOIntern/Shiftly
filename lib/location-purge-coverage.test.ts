import { PURGE_COVERAGE } from "./location-purge";
import { describePurgeCoverage } from "./test-purge-coverage";

describePurgeCoverage(
  "location purge coverage",
  PURGE_COVERAGE,
  "purgeLocationGuarded",
);
