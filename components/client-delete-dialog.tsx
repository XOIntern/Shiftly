"use client";

import { useState } from "react";
import { useActionState } from "react";

import { deleteClient } from "@/app/(dashboard)/clients/actions";
import type { ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DeleteClientDialog({ client }: { client: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);

  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async () => {
      const result = await deleteClient(client.id);
      if (result.ok) setOpen(false);
      return result;
    },
    { ok: false }
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Delete</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete client</DialogTitle>
          <DialogDescription>
            Delete “{client.name}”? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {state.message && <p className="text-sm text-destructive">{state.message}</p>}
        <form action={formAction}>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" type="submit" disabled={pending}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
