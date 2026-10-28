import { z } from "zod";

import { db } from "@/lib/db";
import type { ActionState } from "@/types/action-state";
import type { Tx } from "@/types/db-tx";
import type { RowResult } from "@/types/deleted";

const isUuid = (id: string) => z.uuid().safeParse(id).success;

// Runs one guarded write per selected row, each in its OWN transaction: a
// refusal or a driver error on one row (a unique-index clash, a FK) must not
// undo the rows that went through. Malformed ids are dropped, and a partial
// write is still a full success — applied counts the rows that went through,
// blocked the refused, and the FIRST refusal's message rides back so the UI
// can say why rows were skipped. Cache revalidation is the caller's job.
export async function runPerRow(
  ids: string[],
  guarded: (tx: Tx, id: string) => Promise<RowResult>,
  opts: {
    emptyMessage: string;
    noun: (count: number) => string;
    mapError: (err: unknown) => string;
    validId?: (id: string) => boolean;
  },
): Promise<ActionState> {
  const validId = opts.validId ?? isUuid;
  const validIds = [...new Set(ids)].filter(validId);
  if (validIds.length === 0) {
    return { ok: false, message: opts.emptyMessage };
  }

  let applied = 0;
  let blocked = 0;
  let firstBlocker: string | undefined;
  for (const id of validIds) {
    let result: RowResult;
    try {
      result = await db.transaction((tx) => guarded(tx, id));
    } catch (err) {
      result = { ok: false, message: opts.mapError(err) };
    }
    if (result.ok) {
      applied += 1;
    } else {
      blocked += 1;
      firstBlocker ??= result.message;
    }
  }

  return {
    ok: true,
    applied,
    blocked,
    message:
      blocked > 0
        ? `${blocked} ${opts.noun(blocked)} skipped: ${firstBlocker}`
        : undefined,
  };
}
