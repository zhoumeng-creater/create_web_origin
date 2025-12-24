import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { useSessions } from "../../hooks/useSessions";
import { getActiveSessionId, setActiveSessionId } from "../../lib/storage";
import "./sidebar.css";

const SIDEBAR_COLLAPSE_KEY = "foranimind.sidebarCollapsed";

export const AppSidebar = () => {
  const { items } = useSessions();
  const navigate = useNavigate();
  const activeSessionId = getActiveSessionId();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof localStorage === "undefined") {
      return false;
    }
    return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  });

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

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  return (
    <aside className={`app-sidebar ${isCollapsed ? "collapsed" : ""}`} aria-label="Sidebar">
      <div className="sidebar-top">
        <div className="sidebar-user" title="当前用户">
          <div className="sidebar-avatar" aria-hidden="true" />
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">当前用户</div>
            <div className="sidebar-user-meta">Genesis Studio</div>
          </div>
        </div>
        <button
          type="button"
          className="sidebar-new"
          onClick={handleNewProject}
          aria-label="新建项目"
          title="新建项目"
        >
          <span className="sidebar-new-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <path
                d="M10 4v12M4 10h12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="sidebar-new-label">新建项目</span>
        </button>
      </div>

      <nav className="sidebar-nav">
        <NavLink
          end
          to="/"
          className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
          aria-label="创作"
          title="创作"
        >
          <span className="sidebar-link-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <path
                d="M4 5.5h12v7H7l-3 3z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="sidebar-link-label">创作</span>
        </NavLink>
        <NavLink
          to="/works"
          className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
          aria-label="我的作品"
          title="我的作品"
        >
          <span className="sidebar-link-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <path
                d="M4 5.5h12v9H4z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M6.5 12l2.2-2.4 2.4 2.6 2-2.2 2.4 2.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="sidebar-link-label">我的作品</span>
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
                title={session.title}
                aria-label={session.title}
                className={`session-item ${activeSessionId === session.id ? "active" : ""}`}
                onClick={() => handleSessionSelect(session.id)}
                onKeyDown={(event) => handleSessionKeyDown(session.id, event)}
              >
                <div className="session-main">
                  <span className="session-dot" aria-hidden="true" />
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

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-collapse"
          onClick={toggleCollapsed}
          aria-label={isCollapsed ? "展开侧栏" : "收起侧栏"}
          aria-pressed={!isCollapsed}
          data-tooltip={isCollapsed ? "展开侧栏" : "收起侧栏"}
        >
          <span className="sidebar-collapse-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <path
                d="M4 6h12M4 10h12M4 14h12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </button>
      </div>
    </aside>
  );
};
