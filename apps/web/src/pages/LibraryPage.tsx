import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { listRecentWorks, onRecentWorksUpdate } from "../lib/storage";

export const LibraryPage = () => {
  const [recentWorks, setRecentWorks] = useState(listRecentWorks);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setRecentWorks(listRecentWorks());
    return onRecentWorksUpdate(() => setRecentWorks(listRecentWorks()));
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return recentWorks;
    }
    return recentWorks.filter((item) => {
      const title = String(item.meta.title ?? "").toLowerCase();
      return item.jobId.toLowerCase().includes(needle) || title.includes(needle);
    });
  }, [query, recentWorks]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 28, color: "#111827" }}>Library</h1>
        <p style={{ margin: 0, color: "#6b7280" }}>Browse your generated works.</p>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by title or job id"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            minWidth: 240,
          }}
        />
        <select
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
          }}
        >
          <option value="all">All types</option>
          <option value="scene">Scene</option>
          <option value="motion">Motion</option>
          <option value="music">Music</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: "#9ca3af" }}>No works yet. Generate one on Create.</div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          {filtered.map((item) => (
            <Link
              key={item.jobId}
              to={`/works/${item.jobId}`}
              style={{
                textDecoration: "none",
                color: "#111827",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                background: "#ffffff",
              }}
            >
              <div style={{ fontWeight: 600 }}>{item.meta.title ?? "Untitled work"}</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>{item.jobId}</div>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                Updated {new Date(item.updatedAt).toLocaleString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
