import { describe, expect, it } from "vitest";

import {
  hasPermission,
  permissions,
  type Permission,
  type Role,
} from "./rbac.js";

const expected: Record<Role, Record<Permission, boolean>> = {
  member: {
    "jobs:read": true,
    "jobs:create": true,
    "jobs:control:own": true,
    "members:manage": false,
    "jobs:control:any": false,
    "audit:read": false,
    "system:configure": false,
  },
  admin: {
    "jobs:read": true,
    "jobs:create": true,
    "jobs:control:own": true,
    "members:manage": true,
    "jobs:control:any": true,
    "audit:read": true,
    "system:configure": true,
  },
};

describe("RBAC permission matrix", () => {
  for (const role of ["member", "admin"] as const) {
    for (const permission of permissions) {
      it(`${role} ${expected[role][permission] ? "has" : "does not have"} ${permission}`, () => {
        expect(hasPermission(role, permission)).toBe(expected[role][permission]);
      });
    }
  }
});
