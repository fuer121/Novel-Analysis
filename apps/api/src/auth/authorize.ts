import type { NextFunction, Response } from "express";

import { hasPermission, type Permission } from "@novel-analysis/domain";

import type { AuthenticatedRequest } from "./session-middleware.js";

export function authorize(permission: Permission) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    if (!request.auth || !hasPermission(request.auth.role, permission)) {
      response.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
