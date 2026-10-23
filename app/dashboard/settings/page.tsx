import { and, asc, eq, isNull } from "drizzle-orm";

import { site, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { resolveRules } from "@/lib/engine/resolve";
import type { EffectiveRules, RuleKey } from "@/types/engine";
import {
  loadGlobalRows,
  loadLocationRows,
  loadSiteRows,
} from "@/lib/rule-config";
import { requireUser } from "@/lib/session";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { RuleConfigTable } from "@/components/settings/rule-config-form";
import type { RuleLocationOption, RuleRowView } from "@/types/rule";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Deliberate block: the rules card reads config rows behind the session
// check, so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Rules C1–C7 (docs/architecture.md §5) in display order, with the slot
// each key resolves through in EffectiveRules.
const RULE_META: Array<{
  key: RuleKey;
  slot: keyof EffectiveRules;
  kind: "int" | "bool";
  meaning: string;
  note?: string;
}> = [
  { key: "C1", slot: "c1", kind: "int", meaning: "Max work days per week" },
  { key: "C2", slot: "c2", kind: "int", meaning: "Max work days per month" },
  {
    key: "C3",
    slot: "c3",
    kind: "bool",
    meaning: "Forward shift rotation 1→2→3 only",
  },
  { key: "C4", slot: "c4", kind: "bool", meaning: "Rest day after shift 3" },
  {
    key: "C5",
    slot: "c5",
    kind: "int",
    meaning: "Mandatory break after this many accumulated work days",
  },
  {
    key: "C6",
    slot: "c6",
    kind: "int",
    meaning: "Break length in consecutive days",
  },
  {
    key: "C7",
    slot: "c7",
    kind: "bool",
    meaning: "Work qualification match",
    // The engine check is deliberately dormant until qualification data
    // exists; say so rather than presenting an enforcing rule that isn't.
    note: "Dormant until worker qualifications are recorded",
  },
];

function ruleRows(rules: EffectiveRules): RuleRowView[] {
  return RULE_META.map(({ key, slot, kind, meaning, note }) => ({
    key,
    meaning,
    kind,
    value: rules[slot].value,
    source: rules[slot].source,
    ...(note ? { note } : {}),
  }));
}

// Live locations the edit dialogs may target: a ho picks inside their own
// site, a superadmin across every site (labeled with the parent there).
async function loadLocationOptions(
  siteId: string | null,
): Promise<RuleLocationOption[]> {
  return db
    .select({
      id: siteLocation.id,
      name: siteLocation.name,
      siteName: site.name,
    })
    .from(siteLocation)
    .innerJoin(site, eq(siteLocation.siteId, site.id))
    .where(
      and(
        ...(siteId ? [eq(siteLocation.siteId, siteId)] : []),
        isNull(siteLocation.deletedAt),
      ),
    )
    .orderBy(asc(site.name), asc(siteLocation.name));
}

export default async function SettingsPage() {
  const actor = await requireUser();
  const canEdit = actor.role !== "admin";

  let rules: EffectiveRules;
  let locations: RuleLocationOption[] = [];

  if (actor.role === "admin") {
    // View-only effective rules at the admin's own location. A missing or
    // deleted binding degrades to the bare defaults — never a crash.
    const [bound] = actor.siteLocationId
      ? await db
          .select({ siteId: siteLocation.siteId })
          .from(siteLocation)
          .where(
            and(
              eq(siteLocation.id, actor.siteLocationId),
              isNull(siteLocation.deletedAt),
            ),
          )
          .limit(1)
      : [];
    if (bound) {
      const [globalRows, siteRows, locationRows] = await Promise.all([
        loadGlobalRows(),
        loadSiteRows(bound.siteId),
        loadLocationRows(bound.siteId, actor.siteLocationId!),
      ]);
      rules = resolveRules(globalRows, siteRows, locationRows);
    } else {
      rules = resolveRules([], [], []);
    }
  } else if (actor.role === "ho") {
    // Site-level view: global base + the ho's own site overrides. Location
    // rows stay out of the resolution — with several locations the effective
    // value differs per location, and a single mixed number would lie.
    if (actor.siteId) {
      const [globalRows, siteRows, locationOptions] = await Promise.all([
        loadGlobalRows(),
        loadSiteRows(actor.siteId),
        loadLocationOptions(actor.siteId),
      ]);
      rules = resolveRules(globalRows, siteRows, []);
      locations = locationOptions;
    } else {
      rules = resolveRules([], [], []);
    }
  } else {
    // Unbound superadmin: the global base, with every site's locations as
    // writable override targets.
    const [globalRows, locationOptions] = await Promise.all([
      loadGlobalRows(),
      loadLocationOptions(null),
    ]);
    rules = resolveRules(globalRows, [], []);
    locations = locationOptions;
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Roster rules</CardTitle>
          <CardDescription>
            Roster rules and configuration with per-site overrides. Changes
            take effect without a code deploy and are written to the audit
            log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RuleConfigTable
            rows={ruleRows(rules)}
            locations={locations}
            role={actor.role}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Change the password you sign in with.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
