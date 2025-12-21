import { useMemo, useState } from "react";

import { PreviewPanel } from "../components/preview/PreviewPanel";
import { useWorkDetail } from "../hooks/useWorkDetail";
import { getAssetUrl } from "../lib/api";
import type { Manifest } from "../types/manifest";
import "./pages.css";
import "./workDetail.css";

type WorkDetailPageProps = {
  jobId?: string;
};

type DownloadItem = {
  key: string;
  label: string;
  uri?: string;
};

const buildDownloads = (manifest?: Manifest): DownloadItem[] => {
  if (!manifest) {
    return [];
  }
  const sceneUri = manifest.outputs?.scene?.panorama?.uri;
  const motionUri = manifest.outputs?.motion?.bvh?.uri;
  const musicUri = manifest.outputs?.music?.wav?.uri;
  const mp4Uri = manifest.outputs?.export?.mp4?.uri;
  const zipUri = manifest.outputs?.export?.zip?.uri;
  return [
    { key: "scene", label: "Panorama (PNG)", uri: sceneUri },
    { key: "motion", label: "Motion (BVH)", uri: motionUri },
    { key: "music", label: "Music (WAV)", uri: musicUri },
    { key: "mp4", label: "Export (MP4)", uri: mp4Uri },
    { key: "zip", label: "Export (ZIP)", uri: zipUri },
  ];
};

const formatDate = (value?: string) => {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
};

export const WorkDetailPage = ({ jobId }: WorkDetailPageProps) => {
  const resolvedJobId = jobId?.trim();
  const [copyState, setCopyState] = useState<"idle" | "ok" | "error">("idle");
  const [resolution, setResolution] = useState("1080p");
  const [fps, setFps] = useState("30");
  const [cameraPreset, setCameraPreset] = useState("orbit");

  const { manifest, preview, reload } = useWorkDetail(resolvedJobId);
  const downloads = useMemo(
    () => buildDownloads(manifest.status === "ready" ? manifest.data : undefined),
    [manifest]
  );
  const createdAt =
    manifest.status === "ready" ? formatDate(manifest.data.created_at) : undefined;
  const manifestRaw =
    manifest.status === "ready" ? JSON.stringify(manifest.data, null, 2) : "";

  const handleCopy = async () => {
    if (!resolvedJobId) {
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(resolvedJobId);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = resolvedJobId;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setCopyState("ok");
    } catch {
      setCopyState("error");
    } finally {
      setTimeout(() => setCopyState("idle"), 1200);
    }
  };

  if (!resolvedJobId) {
    return (
      <div className="page work-detail-page">
        <div className="work-detail-empty">Missing job id.</div>
      </div>
    );
  }

  if (manifest.status === "error" && manifest.notFound) {
    return (
      <div className="page work-detail-page">
        <div className="work-detail-empty">
          <div className="work-detail-empty-title">作品未完成或资产被清理</div>
          <p>请返回作品库选择其他作品，或稍后再试。</p>
          <div className="work-detail-actions">
            <button type="button" onClick={reload}>
              Retry
            </button>
            <a className="work-detail-link" href="/works">
              返回作品库
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page work-detail-page">
      <header className="page-header work-detail-header">
        <div className="work-detail-meta">
          <h1 className="page-title">Work {resolvedJobId}</h1>
          <p className="page-subtitle">
            {manifest.status === "loading"
              ? "Loading assets..."
              : manifest.status === "error"
                ? "Manifest failed to load."
                : manifest.status === "ready"
                  ? `Created at ${createdAt ?? "unknown"}`
                  : "Waiting for data."}
          </p>
        </div>
        <div className="work-detail-actions">
          <button type="button" onClick={handleCopy}>
            {copyState === "ok" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy job_id"}
          </button>
          <a className="work-detail-link" href="/works">
            返回作品库
          </a>
        </div>
      </header>

      <section className="work-detail-preview">
        <PreviewPanel
          config={preview.status === "ready" ? preview.data : undefined}
          loading={preview.status === "loading"}
          error={preview.status === "error" ? preview.error : undefined}
          onRetry={reload}
          emptyMessage="Preview config unavailable."
        />
      </section>

      <div className="work-detail-grid">
        <section className="work-detail-section">
          <h2 className="section-title">Downloads</h2>
          {manifest.status === "loading" ? (
            <div className="work-detail-placeholder">Loading resources...</div>
          ) : manifest.status === "error" ? (
            <div className="work-detail-placeholder">
              {manifest.error ?? "Failed to load manifest."}
            </div>
          ) : (
            <div className="download-list">
              {downloads.map((item) => {
                const link = item.uri ? getAssetUrl(item.uri) : undefined;
                return (
                  <div className="download-row" key={item.key}>
                    <div className="download-label">{item.label}</div>
                    {link ? (
                      <a className="download-link" href={link} download>
                        Download
                      </a>
                    ) : (
                      <span className="download-disabled">Unavailable</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="work-detail-section">
          <h2 className="section-title">Export Settings</h2>
          <div className="export-grid">
            <label>
              <span>Resolution</span>
              <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
                <option value="720p">1280 x 720</option>
                <option value="1080p">1920 x 1080</option>
                <option value="4k">3840 x 2160</option>
              </select>
            </label>
            <label>
              <span>Frame rate</span>
              <select value={fps} onChange={(event) => setFps(event.target.value)}>
                <option value="24">24 fps</option>
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </label>
            <label>
              <span>Camera preset</span>
              <select
                value={cameraPreset}
                onChange={(event) => setCameraPreset(event.target.value)}
              >
                <option value="orbit">Orbit</option>
                <option value="static">Static</option>
                <option value="tracking">Tracking</option>
              </select>
            </label>
          </div>
          <button type="button" className="export-button" disabled>
            Export (backend pending)
          </button>
          <p className="export-note">Export service is not available yet.</p>
        </section>
      </div>

      {manifest.status === "ready" ? (
        <details className="work-detail-manifest">
          <summary>Manifest JSON</summary>
          <pre>{manifestRaw}</pre>
        </details>
      ) : null}
    </div>
  );
};
