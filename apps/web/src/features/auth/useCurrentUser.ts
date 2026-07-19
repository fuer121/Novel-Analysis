import { useQuery } from "@tanstack/react-query";

import { refreshCurrentUser } from "../../shared/api.js";

export const currentUserKey = ["current-user"] as const;

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: refreshCurrentUser,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
