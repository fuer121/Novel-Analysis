export const FEISHU_USERS = {
  admin: {
    code: "phase1-admin-code",
    identity: { unionId: "phase1-admin", displayName: "Phase 1 Admin", avatarUrl: null },
    role: "admin" as const,
  },
  member: {
    code: "phase1-member-code",
    identity: { unionId: "phase1-member", displayName: "Phase 1 Member", avatarUrl: null },
    role: "member" as const,
  },
};
