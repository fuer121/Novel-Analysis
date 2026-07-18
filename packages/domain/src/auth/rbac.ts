export const permissions = [
  "jobs:read",
  "jobs:create",
  "jobs:control:own",
  "members:manage",
  "jobs:control:any",
  "audit:read",
  "system:configure",
] as const;

export type Permission = (typeof permissions)[number];
export type Role = "admin" | "member";

const memberPermissions = new Set<Permission>([
  "jobs:read",
  "jobs:create",
  "jobs:control:own",
]);

const adminPermissions = new Set<Permission>(permissions);

export function hasPermission(role: Role, permission: Permission): boolean {
  return (role === "admin" ? adminPermissions : memberPermissions).has(permission);
}
