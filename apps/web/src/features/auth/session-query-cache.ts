import type { QueryClient } from "@tanstack/react-query";

export function clearPriorSessionQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "current-user" });
}
