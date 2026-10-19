"use client";

import { Trash2Icon } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function RowDeleteItem({
  isActive,
  onOpen,
}: {
  isActive: boolean;
  onOpen: () => void;
}) {
  // Delete is a post-deactivation verb, same rule as the bulk toolbar:
  // an Active row offers no Delete until it is deactivated first.
  if (isActive) return null;

  return (
    <DropdownMenuItem variant="destructive" onClick={onOpen}>
      <Trash2Icon />
      Delete
    </DropdownMenuItem>
  );
}
