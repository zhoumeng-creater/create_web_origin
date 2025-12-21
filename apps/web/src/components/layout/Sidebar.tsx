import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";

import { listRecentWorks, onRecentWorksUpdate } from "../../lib/storage";

const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  color: isActive ? "#111827" : "#6b7280",
  fontWeight: isActive ? 600 : 500,
  textDecoration: "none",
});

export const Sidebar = () => {
  const [recentWorks, setRecentWorks] = useState(listRecentWorks);

  useEffect(() => {
    setRecentWorks(listRecentWorks());
    return onRecentWorksUpdate(() => setRecentWorks(listRecentWorks()));
  }, []);

  return (
    <aside
      style={{
        width: 260,
        padding: "24px 20px",
        borderRight: "1px solid #e5e7eb",
        background: "#f9fafb",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <Link to="/" style={{ textDecoration: "none", color: "#111827", fontWeight: 700 }}>
        Foranimind
      </Link>

      <nav style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <NavLink to="/" end style={navLinkStyle}>
          New Project
        </NavLink>
        <NavLink to="/works" style={navLinkStyle}>
          My Works
        </NavLink>
      </nav>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>
          Recent (last 10)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {recentWorks.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9ca3af" }}>No recent works yet.</div>
          ) : (
            recentWorks.map((item) => (
              <Link
                key={item.jobId}
                to={`/works/${item.jobId}`}
                style={{
                  textDecoration: "none",
                  color: "#111827",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {item.meta.title ?? item.jobId}
              </Link>
            ))
          )}
        </div>
      </div>
    </aside>
  );
};
