import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";

import { saveRecentWork } from "../lib/storage";

export const WorkDetailPage = () => {
  const { id } = useParams();
  const jobId = id ?? "unknown";

  useEffect(() => {
    if (id) {
      saveRecentWork(id, { title: `Work ${id}` });
    }
  }, [id]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Link to="/works" style={{ color: "#2563eb", textDecoration: "none" }}>
          Back to Library
        </Link>
        <h1 style={{ margin: 0, fontSize: 28, color: "#111827" }}>Work Detail</h1>
        <p style={{ margin: 0, color: "#6b7280" }}>Job ID: {jobId}</p>
      </header>

      <section style={{ padding: 20, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 12 }}>
          Preview
        </div>
        <div style={{ color: "#9ca3af" }}>3D + audio + timeline preview area.</div>
      </section>

      <section style={{ padding: 20, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 12 }}>
          Assets
        </div>
        <div style={{ color: "#9ca3af" }}>Downloads and raw assets list.</div>
      </section>

      <section style={{ padding: 20, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 12 }}>
          Export Settings
        </div>
        <div style={{ color: "#9ca3af" }}>Export format and configuration.</div>
      </section>
    </div>
  );
};
