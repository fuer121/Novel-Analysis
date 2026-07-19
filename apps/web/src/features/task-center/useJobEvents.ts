import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { refreshCurrentUser } from "../../shared/api.js";

export function useJobEvents(enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/job-events", { withCredentials: true });
    let active = true;
    let authenticationCheck: Promise<void> | null = null;
    source.onmessage = (message) => {
      if (!active) return;
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      try {
        const event = JSON.parse(message.data) as { jobId?: unknown };
        if (typeof event.jobId === "string") {
          void queryClient.invalidateQueries({ queryKey: ["job", event.jobId] });
        }
      } catch {
        // A malformed event cannot replace API-backed task state
      }
    };
    source.onerror = () => {
      if (!active || authenticationCheck) return;
      const check = refreshCurrentUser()
        .then(() => undefined)
        .catch(() => {
          if (active) source.close();
        })
        .finally(() => {
          if (authenticationCheck === check) authenticationCheck = null;
        });
      authenticationCheck = check;
    };
    return () => {
      active = false;
      source.onmessage = null;
      source.onerror = null;
      source.close();
    };
  }, [enabled, queryClient]);
}
