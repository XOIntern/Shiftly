import { Badge } from "@/components/ui/badge";

export function StatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="destructive">Inactive</Badge>
  );
}
