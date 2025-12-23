import { useEffect, useMemo, useState } from "react";

import { PreviewPanel } from "../components/preview/PreviewPanel";
import { useWorkDetail } from "../hooks/useWorkDetail";
import { getAssetUrl } from "../lib/api";
import type { Manifest } from "../types/manifest";
import "./pages.css";
import "./workDetail.css";

type WorkDetailPageProps = {
  jobId?: string;
};

type AssetKind = "image" | "motion" | "audio" | "video" | "bundle";

type AssetItem = {
  key: string;
  label: string;
  title: string;
  kind: AssetKind;
  uri?: string;
};

const ASSET_SPECS: Array<
  Omit<AssetItem, "uri"> & { getUri: (manifest?: Manifest) => string | undefined }
> = [
  {
    key: "scene",
    label: "PNG",
    title: "Panorama",
    kind: "image",
    getUri: (manifest) => manifest?.outputs?.scene?.panorama?.uri,
  },
  {
    key: "motion",
    label: "BVH",
    title: "Motion",
    kind: "motion",
    getUri: (manifest) => manifest?.outputs?.motion?.bvh?.uri,
  },
  {
    key: "music",
    label: "WAV",
    title: "Audio",
    kind: "audio",
    getUri: (manifest) => manifest?.outputs?.music?.wav?.uri,
  },
  {
    key: "mp4",
    label: "MP4",
    title: "Video",
    kind: "video",
    getUri: (manifest) => manifest?.outputs?.export?.mp4?.uri,
  },
  {
    key: "zip",
    label: "ZIP",
    title: "Bundle",
    kind: "bundle",
    getUri: (manifest) => manifest?.outputs?.export?.zip?.uri,
  },
];

const buildAssets = (manifest?: Manifest): AssetItem[] =>
  ASSET_SPECS.map((spec) => ({
    key: spec.key,
    label: spec.label,
    title: spec.title,
    kind: spec.kind,
    uri: spec.getUri(manifest),
  }));

const AssetIcon = ({ kind }: { kind: AssetKind }) => {
  switch (kind) {
    case "image":
      return (
        <svg viewBox="0 0 20 20" className="work-detail-asset-icon" aria-hidden="true">
          <rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 12l2.2-2.2 3 3 2-2 2.8 2.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="7.2" cy="8" r="1.2" fill="currentColor" />
        </svg>
      );
    case "motion":
      return (
        <svg viewBox="0 0 20 20" className="work-detail-asset-icon" aria-hidden="true">
          <path d="M4 14l3-3 2 2 4-4 3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 6h4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "audio":
      return (
        <svg viewBox="0 0 20 20" className="work-detail-asset-icon" aria-hidden="true">
          <path d="M5 12V8l5-2v8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="5" cy="12.5" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="10" cy="14" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case "video":
      return (
        <svg viewBox="0 0 20 20" className="work-detail-asset-icon" aria-hidden="true">
          <rect x="3" y="5" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M9 8l4 2-4 2z" fill="currentColor" />
        </svg>
      );
    case "bundle":
    default:
      return (
        <svg viewBox="0 0 20 20" className="work-detail-asset-icon" aria-hidden="true">
          <path d="M4 7l6-3 6 3-6 3-6-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M4 7v6l6 3 6-3V7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
  }
};

export const WorkDetailPage = ({ jobId }: WorkDetailPageProps) => {
  const resolvedJobId = jobId?.trim();
  const [copyState, setCopyState] = useState<"idle" | "ok" | "error">("idle");
  const [resolution, setResolution] = useState("1080p");
  const [fps, setFps] = useState("30");
  const [cameraPreset, setCameraPreset] = useState("orbit");
  const [panelOpen, setPanelOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(true);
  const [exportExpanded, setExportExpanded] = useState(false);

  const { manifest, preview, reload } = useWorkDetail(resolvedJobId);
  const assets = useMemo(
    () => buildAssets(manifest.status === "ready" ? manifest.data : undefined),
    [manifest]
  );
  const manifestRaw =
    manifest.status === "ready" ? JSON.stringify(manifest.data, null, 2) : "";
  const statusInfo = useMemo(() => {
    if (manifest.status === "loading") {
      return { label: "Loading", tone: "loading" };
    }
    if (manifest.status === "error") {
      return { label: manifest.notFound ? "Not found" : "Error", tone: "error" };
    }
    if (manifest.status === "ready" && preview.status === "loading") {
      return { label: "Preview loading", tone: "loading" };
    }
    if (preview.status === "error") {
      return { label: "Preview issue", tone: "warning" };
    }
    if (manifest.status === "ready") {
      return { label: "Ready", tone: "ready" };
    }
    return { label: "Idle", tone: "idle" };
  }, [manifest.notFound, manifest.status, preview.status]);
  const exportSummary = useMemo(() => {
    const resolutionLabel = resolution === "4k" ? "4K" : resolution;
    const cameraLabel = cameraPreset.replace(/^\w/, (match) => match.toUpperCase());
    return `${resolutionLabel} \u00b7 ${fps}fps \u00b7 ${cameraLabel}`;
  }, [cameraPreset, fps, resolution]);

  useEffect(() => {
    if (!panelOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanelOpen(false);
      }
    };
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [panelOpen]);

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
          <div className="work-detail-empty-title">Work is not available.</div>
          <p>Return to the library or try again later.</p>
          <div className="work-detail-actions">
            <button type="button" onClick={reload}>
              Retry
            </button>
            <a className="work-detail-link" href="/works">
              Back to Library
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page work-detail-page">
      <header className="page-header work-detail-header">
        <a className="work-detail-back" href="/works">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              d="M11.5 5L6.5 10l5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </a>
        <div className="work-detail-title">
          <h1 className="page-title">Work {resolvedJobId}</h1>
          <span className={`work-detail-status ${statusInfo.tone}`}>
            <span className="work-detail-status-dot" aria-hidden="true" />
            {statusInfo.label}
          </span>
        </div>
        <button
          type="button"
          className="work-detail-copy"
          onClick={handleCopy}
          title={
            copyState === "ok"
              ? "Copied"
              : copyState === "error"
                ? "Copy failed"
                : "Copy job id"
          }
          aria-label="Copy job id"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              d="M7 6.5h7.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M5 13.5H4a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1h7.5a1 1 0 0 1 1 1V5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      <section className="work-detail-preview">
        <div className="work-detail-preview-shell">
          <PreviewPanel
            config={preview.status === "ready" ? preview.data : undefined}
            loading={preview.status === "loading"}
            error={preview.status === "error" ? preview.error : undefined}
            onRetry={reload}
            emptyMessage="Preview config unavailable."
          />
          <button
            type="button"
            className="work-detail-panel-toggle"
            onClick={() => setPanelOpen(true)}
            aria-label="Open assets and export"
            title="Assets and export"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path
                d="M4.5 6.5h11M4.5 10h11M4.5 13.5h7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </section>

      <div className={`work-detail-drawer${panelOpen ? " open" : ""}`} aria-hidden={!panelOpen}>
        <div className="work-detail-drawer-overlay" onClick={() => setPanelOpen(false)} />
        <aside className="work-detail-drawer-panel" role="dialog" aria-modal="true">
          <header className="work-detail-drawer-header">
            <div>
              <div className="work-detail-drawer-title">Assets & Export</div>
              <div className="work-detail-drawer-subtitle">Manage output files.</div>
            </div>
            <button
              type="button"
              className="work-detail-drawer-close"
              onClick={() => setPanelOpen(false)}
            >
              Close
            </button>
          </header>

          <section className="work-detail-panel">
            <button
              type="button"
              className="work-detail-panel-header"
              onClick={() => setAssetsOpen((prev) => !prev)}
              aria-expanded={assetsOpen}
            >
              <span>Assets</span>
              <span className={`work-detail-panel-chevron${assetsOpen ? " open" : ""}`} />
            </button>
            {assetsOpen ? (
              <div className="work-detail-assets">
                {assets.map((item) => {
                  const link = item.uri ? getAssetUrl(item.uri) : undefined;
                  const content = (
                    <>
                      <AssetIcon kind={item.kind} />
                      <span className="work-detail-asset-label">{item.label}</span>
                    </>
                  );
                  return link ? (
                    <a
                      key={item.key}
                      className="work-detail-asset"
                      href={link}
                      download
                      title={`${item.title} (${item.label})`}
                    >
                      {content}
                    </a>
                  ) : (
                    <div
                      key={item.key}
                      className="work-detail-asset disabled"
                      aria-disabled="true"
                      title={`${item.title} (${item.label})`}
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className="work-detail-panel">
            <div className="work-detail-export-summary">
              <div>
                <div className="work-detail-export-label">Export preset</div>
                <div className="work-detail-export-value">{exportSummary}</div>
              </div>
              <button
                type="button"
                className="work-detail-export-toggle"
                onClick={() => setExportExpanded((prev) => !prev)}
                aria-expanded={exportExpanded}
              >
                Export
              </button>
            </div>
            {exportExpanded ? (
              <div className="work-detail-export-form">
                <label>
                  <span>Resolution</span>
                  <select
                    value={resolution}
                    onChange={(event) => setResolution(event.target.value)}
                  >
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
                <button type="button" className="work-detail-export-button" disabled>
                  Export (backend pending)
                </button>
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      {manifest.status === "ready" ? (
        <details className="work-detail-manifest">
          <summary>Debug / Advanced</summary>
          <pre>{manifestRaw}</pre>
        </details>
      ) : null}
    </div>
  );
};
