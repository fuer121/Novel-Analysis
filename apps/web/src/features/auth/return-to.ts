export function safeReturnTo(value: string | null): string {
  if (
    value === "/tasks"
    || value === "/books"
    || value === "/admin/members"
    || /^\/tasks\/[^/?#]+$/.test(value ?? "")
    || /^\/books\/[^/?#]+\/(overview|import|l1|l2)$/.test(value ?? "")
  ) return value!;
  return "/tasks";
}

export function loginPath(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}
