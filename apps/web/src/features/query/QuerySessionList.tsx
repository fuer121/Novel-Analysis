import type { QuerySession } from "@novel-analysis/contracts";
import { useEffect, useRef } from "react";

type Props = {
  sessions: QuerySession[];
  selectedId: string | null;
  onSelect: (session: QuerySession) => void;
  onCreate: () => void;
  drawerOpen: boolean;
  onClose: () => void;
};

export function QuerySessionList({ sessions, selectedId, onSelect, onCreate, drawerOpen, onClose }: Props) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!drawerOpen) return;
    closeRef.current?.focus();
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])];
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", containFocus);
    return () => document.removeEventListener("keydown", containFocus);
  }, [drawerOpen, onClose]);

  const contents = <>
    <div className="query-rail-heading"><strong>研究会话</strong><button className="text-button" type="button" onClick={onCreate}>新建会话</button></div>
    <div className="query-session-items">
      {sessions.map((session) => <button type="button" key={session.id} aria-current={session.id === selectedId ? "true" : undefined} onClick={() => { onSelect(session); onClose(); }}>
        <strong>{session.title}</strong><small>{session.defaultStartChapter}-{session.defaultEndChapter} 章 · {session.visibility === "team" ? "团队" : "仅自己"}</small>
      </button>)}
      {sessions.length === 0 ? <p className="query-empty">还没有研究会话</p> : null}
    </div>
  </>;
  return <>
    <aside className="query-session-rail" aria-label="研究会话">{contents}</aside>
    {drawerOpen ? <div className="query-drawer-backdrop" onMouseDown={onClose}>
      <section ref={drawerRef} className="query-session-drawer" role="dialog" aria-modal="true" aria-label="研究会话" onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeRef} className="text-button drawer-close" type="button" onClick={onClose}>关闭会话列表</button>{contents}
      </section>
    </div> : null}
  </>;
}
