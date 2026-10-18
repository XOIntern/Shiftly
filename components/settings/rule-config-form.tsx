"use client";

import { useId, useState, useTransition } from "react";

import { updateRuleConfig } from "@/app/dashboard/settings/rule-config-actions";
import type { RuleKey, RuleSource } from "@/lib/engine/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ActorRole = "superadmin" | "ho" | "admin";

// One row of the rules table — the effective value plus where it came from.
// The server resolves it; the client never recomputes inheritance.
export type RuleRowView = {
  key: RuleKey;
  meaning: string;
  kind: "int" | "bool";
  value: number | boolean;
  source: RuleSource;
};

// Live locations the dialog may target, already limited by the server to
// what the actor may touch (their own site for a ho, all sites for a
// superadmin).
export type RuleLocationOption = {
  id: string;
  name: string;
  siteName: string;
};

// Sanity ranges mirrored from lib/rule-config-validators.ts so the inputs
// nudge before the server roundtrip; the action stays authoritative.
const INT_BOUNDS: Partial<Record<RuleKey, { min: number; max?: number }>> = {
  C1: { min: 1, max: 7 },
  C2: { min: 1, max: 31 },
  C5: { min: 1 },
  C6: { min: 1 },
};

function formatValue(row: RuleRowView): string {
  return row.kind === "bool"
    ? row.value
      ? "Enabled"
      : "Disabled"
    : String(row.value);
}

// The write scope follows the actor, not the row's source: a ho writes
// their own site (or a location in it), a superadmin the global base (or
// any named location) — exactly the scopes updateRuleConfig accepts, so
// no option on the list can only end in a server-side refusal.
function scopeItems(
  role: ActorRole,
  hasLocations: boolean,
): Array<{ label: string; value: "global" | "site" | "location" }> {
  if (role === "superadmin") {
    return [
      { label: "Global base", value: "global" },
      ...(hasLocations
        ? [{ label: "Location override", value: "location" as const }]
        : []),
    ];
  }
  return [
    { label: "Site override", value: "site" },
    ...(hasLocations
      ? [{ label: "Location override", value: "location" as const }]
      : []),
  ];
}

function RuleEditForm({
  row,
  locations,
  role,
  onSaved,
}: {
  row: RuleRowView;
  locations: RuleLocationOption[];
  role: ActorRole;
  onSaved: () => void;
}) {
  const scopeFieldId = useId();
  const locationFieldId = useId();
  const valueFieldId = useId();

  const [scope, setScope] = useState<"global" | "site" | "location">(
    role === "superadmin" ? "global" : "site",
  );
  const [locationId, setLocationId] = useState<string | null>(null);
  const [intValue, setIntValue] = useState(
    row.kind === "int" ? String(row.value) : "",
  );
  const [boolValue, setBoolValue] = useState(row.value === true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const bounds = INT_BOUNDS[row.key];
  const items = scopeItems(role, locations.length > 0);

  const locationItems: {
    label: string;
    value: string | null;
    disabled?: boolean;
  }[] = [
    { label: "Select a location", value: null, disabled: true },
    ...locations.map(({ id, name, siteName }) => ({
      // A superadmin picks across sites, so the parent disambiguates.
      label:
        role === "superadmin" && siteName ? `${siteName} (${name})` : name,
      value: id,
    })),
  ];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);

    // Pre-submit guards mirroring the user form: an unselected location
    // select must not submit, and a malformed number stays client-side.
    const errors: Record<string, string> = {};
    if (scope === "location" && !locationId) {
      errors.siteLocationId = "Location is required.";
    }
    let parsed: number | null = null;
    if (row.kind === "int") {
      if (intValue.trim() === "") {
        parsed = null; // the server answers "Value is required."
      } else if (!Number.isInteger(Number(intValue))) {
        errors.intValue = "Enter a whole number.";
      } else {
        parsed = Number(intValue);
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    startTransition(async () => {
      const result = await updateRuleConfig({
        ruleKey: row.key,
        scope,
        ...(scope === "location" ? { siteLocationId: locationId ?? undefined } : {}),
        intValue: row.kind === "int" ? parsed : null,
        boolValue: row.kind === "bool" ? boolValue : null,
      });

      if (result.ok) {
        onSaved();
        return;
      }
      if (result.fieldErrors) {
        const known = ["scope", "siteId", "siteLocationId", "intValue", "boolValue", "form"];
        const stray = Object.entries(result.fieldErrors).filter(
          ([key]) => !known.includes(key),
        );
        if (stray.length > 0) {
          setMessage(stray.map(([, value]) => value).join(". "));
        }
        setFieldErrors(result.fieldErrors);
      }
      if (result.message) setMessage(result.message);
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className="gap-4">
        {message ? <FieldError>{message}</FieldError> : null}
        {fieldErrors?.form ? <FieldError>{fieldErrors.form}</FieldError> : null}
        <Field data-invalid={fieldErrors?.scope ? "true" : undefined}>
          <FieldLabel htmlFor={scopeFieldId}>Scope</FieldLabel>
          <Select
            items={items}
            value={scope}
            onValueChange={(value) =>
              setScope(value as "global" | "site" | "location")
            }
          >
            <SelectTrigger id={scopeFieldId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {fieldErrors?.scope ? (
            <FieldError errors={[{ message: fieldErrors.scope }]} />
          ) : null}
        </Field>
        {scope === "location" ? (
          <Field data-invalid={fieldErrors?.siteLocationId ? "true" : undefined}>
            <FieldLabel htmlFor={locationFieldId}>Location</FieldLabel>
            <Select
              items={locationItems}
              value={locationId}
              onValueChange={(value) => setLocationId(value as string | null)}
            >
              <SelectTrigger id={locationFieldId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {locationItems.map((item) => (
                    <SelectItem
                      key={item.value ?? "placeholder"}
                      value={item.value}
                      disabled={item.disabled}
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {locations.length === 0 ? (
              <FieldDescription>No live locations available.</FieldDescription>
            ) : null}
            {fieldErrors?.siteLocationId ? (
              <FieldError errors={[{ message: fieldErrors.siteLocationId }]} />
            ) : null}
          </Field>
        ) : null}
        {row.kind === "int" ? (
          <Field data-invalid={fieldErrors?.intValue ? "true" : undefined}>
            <FieldLabel htmlFor={valueFieldId}>Value</FieldLabel>
            <Input
              id={valueFieldId}
              name="intValue"
              type="number"
              inputMode="numeric"
              value={intValue}
              onChange={(event) => setIntValue(event.target.value)}
              aria-invalid={fieldErrors?.intValue ? true : undefined}
              min={bounds?.min}
              max={bounds?.max}
              step={1}
            />
            {bounds ? (
              <FieldDescription>
                {bounds.max !== undefined
                  ? `Between ${bounds.min} and ${bounds.max}.`
                  : `At least ${bounds.min}.`}
              </FieldDescription>
            ) : null}
            {fieldErrors?.intValue ? (
              <FieldError errors={[{ message: fieldErrors.intValue }]} />
            ) : null}
          </Field>
        ) : (
          <Field data-invalid={fieldErrors?.boolValue ? "true" : undefined}>
            <FieldLabel htmlFor={valueFieldId}>Value</FieldLabel>
            <div className="flex items-center gap-2">
              <Checkbox
                id={valueFieldId}
                checked={boolValue}
                onCheckedChange={(checked) => setBoolValue(checked === true)}
                aria-invalid={fieldErrors?.boolValue ? true : undefined}
              />
              <Label htmlFor={valueFieldId} className="font-normal">
                Enabled
              </Label>
            </div>
            {fieldErrors?.boolValue ? (
              <FieldError errors={[{ message: fieldErrors.boolValue }]} />
            ) : null}
          </Field>
        )}
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

function RuleEditDialog({
  row,
  locations,
  role,
  open,
  onOpenChange,
}: {
  row: RuleRowView;
  locations: RuleLocationOption[];
  role: ActorRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit rule {row.key}</DialogTitle>
          <DialogDescription>
            {row.meaning}. The change is audited and applies without a code
            deploy.
          </DialogDescription>
        </DialogHeader>
        {/* Remounted per open so state resets to the row's effective values
        instead of keeping the last visit's edits. */}
        {open ? (
          <RuleEditForm
            row={row}
            locations={locations}
            role={role}
            onSaved={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function RuleConfigTable({
  rows,
  locations,
  role,
  canEdit,
}: {
  rows: RuleRowView[];
  locations: RuleLocationOption[];
  role: ActorRole;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<RuleRowView | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[60px]">Rule</TableHead>
            <TableHead className="min-w-[240px]">Meaning</TableHead>
            <TableHead className="min-w-[80px]">Value</TableHead>
            <TableHead className="min-w-[100px]">Source</TableHead>
            {canEdit ? (
              <TableHead className="min-w-[70px] text-right">
                Actions
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="font-medium">{row.key}</TableCell>
              <TableCell>{row.meaning}</TableCell>
              <TableCell className="tabular-nums">
                {formatValue(row)}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{row.source}</Badge>
              </TableCell>
              {canEdit ? (
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(row)}
                  >
                    Edit
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <RuleEditDialog
        row={editing ?? rows[0]}
        locations={locations}
        role={role}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </>
  );
}
