import type { QuerySession } from "@novel-analysis/contracts";
import { useEffect } from "react";

type Props = {
  sessions: QuerySession[];
  selectedId: string | null;
  onSelect: (session: QuerySession) => void;
  onCreate: () => void;
  drawerOpen: boolean;
  onClose: () => void;
};

export function QuerySessionList({ sessions, selectedId, onSelect, onCreate, drawerOpen, onClose }: Props) {
  useEffect(() => {
    if (!drawerOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
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
      <section className="query-session-drawer" role="dialog" aria-modal="true" aria-label="研究会话" onMouseDown={(event) => event.stopPropagation()}>
        <button className="text-button drawer-close" type="button" onClick={onClose}>关闭会话列表</button>{contents}
      </section>
    </div> : null}
  </>;
}
