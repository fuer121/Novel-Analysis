import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import { refreshCurrentUser } from "../../shared/api.js";
import { currentUserKey } from "./useCurrentUser.js";

function validatedReturnTo(value: string | null): string {
  if (value === "/tasks" || value === "/admin/members" || /^\/tasks\/[^/?#]+$/.test(value ?? "")) {
    return value!;
  }
  return "/tasks";
}

export function AuthCompletePage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void refreshCurrentUser().then((user) => {
      if (!active) return;
      queryClient.setQueryData(currentUserKey, user);
      navigate(validatedReturnTo(search.get("returnTo")), { replace: true });
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [navigate, queryClient, search]);

  if (failed) {
    return (
      <main className="centered-state">
        <h1>登录未完成</h1>
        <a className="primary-button" href="/login">重新登录</a>
      </main>
    );
  }
  return <main className="centered-state" aria-live="polite">正在进入工作区...</main>;
}
