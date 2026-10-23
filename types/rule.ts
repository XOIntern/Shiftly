import type { RuleKey, RuleSource } from "./engine";

// One row of the rules table — the effective value plus where it came from.
// The server resolves it; the client never recomputes inheritance.
// note is orthogonal to meaning: an optional caveat about what the rule
// actually enforces today (C7 is dormant until qualification data exists).
export type RuleRowView = {
  key: RuleKey;
  meaning: string;
  kind: "int" | "bool";
  value: number | boolean;
  source: RuleSource;
  note?: string;
};

// Live locations the dialog may target, already limited by the server to
// what the actor may touch (their own site for a ho, all sites for a
// superadmin).
export type RuleLocationOption = {
  id: string;
  name: string;
  siteName: string;
};
