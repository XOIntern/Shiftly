export type DeletedRow = { id: string; deletedAt: string };

export type RowResult = { ok: true } | { ok: false; message: string };

export type PurgeCoverage = {
  purged: string[];
  history: string[];
  cascade: string[];
};
