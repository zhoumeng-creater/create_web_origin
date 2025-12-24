import type { KeyboardEvent, MouseEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { useSessions } from "../../hooks/useSessions";
import { getActiveSessionId, setActiveSessionId } from "../../lib/storage";
import "./sidebar.css";

export const AppSidebar = () => {
  const { items } = useSessions();
  const navigate = useNavigate();
  const activeSessionId = getActiveSessionId();

  const handleNewProject = () => {
    setActiveSessionId(null);
    navigate("/");
  };

  const handleSessionSelect = (sessionId: string) => {
    setActiveSessionId(sessionId);
    navigate("/");
  };

  const handleSessionKeyDown = (sessionId: string, event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleSessionSelect(sessionId);
    }
  };

  const handleOpenDetail = (jobId: string, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    navigate(`/works/${jobId}`);
  };

  return (
    <aside className="app-sidebar">
      <div className="sidebar-top">
        <div className="sidebar-user">
          <div className="sidebar-avatar" aria-hidden="true" />
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">当前用户</div>
            <div className="sidebar-user-meta">Genesis Studio</div>
          </div>
        </div>
        <button type="button" className="sidebar-new" onClick={handleNewProject}>
          新建项目
        </button>
      </div>

      <nav className="sidebar-nav">
        <NavLink end to="/" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          创作
        </NavLink>
        <NavLink to="/works" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          我的作品
        </NavLink>
      </nav>

      <div className="sidebar-list">
        <div className="sidebar-list-header">最近项目</div>
        <div className="sidebar-list-body">
          {items.length === 0 ? (
            <div className="sidebar-empty">暂无项目</div>
          ) : (
            items.map((session) => (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                className={`session-item ${activeSessionId === session.id ? "active" : ""}`}
                onClick={() => handleSessionSelect(session.id)}
                onKeyDown={(event) => handleSessionKeyDown(session.id, event)}
              >
                <div className="session-main">
                  <div className="session-title">{session.title}</div>
                </div>
                {session.status === "done" && session.jobId ? (
                  <button
                    type="button"
                    className="session-open"
                    aria-label="Open detail"
                    onClick={(event) => handleOpenDetail(session.jobId, event)}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <path
                        d="M6 14l8-8M9 6h5v5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
};
