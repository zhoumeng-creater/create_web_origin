import { useEffect, useMemo, useState } from "react";

import { getAssetUrl } from "../../lib/api";
import { AssetRef, Manifest } from "../../types/manifest";
import { PreviewConfig } from "../../types/previewConfig";
import { useJobArtifacts } from "../../hooks/useJobArtifacts";

type InspectorStep3Props = {
  jobId: string | null;
  isDone: boolean;
};

type TabKey = "preview" | "assets" | "export";

type ExportSettings = {
  width: number;
  height: number;
  fps: number;
  cameraPreset: string;
};

const buildAssetList = (manifest: Manifest | null) => {
  const outputs = manifest?.outputs;
  const assets: Array<{ label: string; ref?: AssetRef | null }> = [
    { label: "Scene PNG", ref: outputs?.scene?.panorama },
    { label: "Motion BVH", ref: outputs?.motion?.bvh },
    { label: "Music WAV", ref: outputs?.music?.wav },
    { label: "Export MP4", ref: outputs?.export?.mp4 },
    { label: "Export ZIP", ref: outputs?.export?.zip },
  ];
  return assets.filter((item) => Boolean(item.ref?.uri));
};

const buildPreviewMeta = (previewConfig: PreviewConfig | null) => {
  return {
    panorama: previewConfig?.scene?.panorama_uri ?? null,
    bvh: previewConfig?.motion?.bvh_uri ?? null,
    wav: previewConfig?.music?.wav_uri ?? null,
    cameraPreset: previewConfig?.camera?.preset ?? "",
  };
};

export const InspectorStep3 = ({ jobId, isDone }: InspectorStep3Props) => {
  const [activeTab, setActiveTab] = useState<TabKey>("preview");
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    width: 1920,
    height: 1080,
    fps: 30,
    cameraPreset: "",
  });
  const { manifest, previewConfig, error, isLoading } = useJobArtifacts(jobId, isDone);
  const previewMeta = useMemo(() => buildPreviewMeta(previewConfig), [previewConfig]);
  const assets = useMemo(() => buildAssetList(manifest), [manifest]);

  useEffect(() => {
    setActiveTab("preview");
  }, [jobId]);

  useEffect(() => {
    if (previewMeta.cameraPreset) {
      setExportSettings((prev) => ({
        ...prev,
        cameraPreset: previewMeta.cameraPreset,
      }));
    }
  }, [previewMeta.cameraPreset]);

  const renderPreviewTab = () => {
    if (isLoading) {
      return <div style={{ fontSize: 12, color: "#9ca3af" }}>Loading preview data...</div>;
    }
    if (!previewConfig) {
      return <div style={{ fontSize: 12, color: "#9ca3af" }}>Preview data unavailable.</div>;
    }
    const panoramaUrl = previewMeta.panorama ? getAssetUrl(previewMeta.panorama) : null;
    const bvhUrl = previewMeta.bvh ? getAssetUrl(previewMeta.bvh) : null;
    const wavUrl = previewMeta.wav ? getAssetUrl(previewMeta.wav) : null;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            borderRadius: 12,
            border: "1px dashed #d1d5db",
            padding: 16,
            background: "#f9fafb",
            color: "#6b7280",
            fontSize: 12,
          }}
        >
          3D preview placeholder (scene + motion + music)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          <div>Panorama: {panoramaUrl ? "Loaded" : "--"}</div>
          {panoramaUrl ? (
            <a href={panoramaUrl} target="_blank" rel="noreferrer">
              {panoramaUrl}
            </a>
          ) : null}
          <div>BVH: {bvhUrl ? "Loaded" : "--"}</div>
          {bvhUrl ? (
            <a href={bvhUrl} target="_blank" rel="noreferrer">
              {bvhUrl}
            </a>
          ) : null}
          <div>WAV: {wavUrl ? "Loaded" : "--"}</div>
          {wavUrl ? (
            <a href={wavUrl} target="_blank" rel="noreferrer">
              {wavUrl}
            </a>
          ) : null}
        </div>
      </div>
    );
  };

  const renderAssetsTab = () => {
    if (isLoading) {
      return <div style={{ fontSize: 12, color: "#9ca3af" }}>Loading manifest...</div>;
    }
    if (!manifest) {
      return <div style={{ fontSize: 12, color: "#9ca3af" }}>Manifest data unavailable.</div>;
    }
    if (assets.length === 0) {
      return <div style={{ fontSize: 12, color: "#9ca3af" }}>No assets found.</div>;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {assets.map((asset) => {
          const url = asset.ref?.uri ? getAssetUrl(asset.ref.uri) : null;
          if (!url) {
            return null;
          }
          return (
            <div
              key={`${asset.label}-${url}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 10px",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                fontSize: 12,
                background: "#ffffff",
              }}
            >
              <div>{asset.label}</div>
              <a href={url} download>
                Download
              </a>
            </div>
          );
        })}
      </div>
    );
  };

  const renderExportTab = () => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>Width</span>
            <input
              type="number"
              value={exportSettings.width}
              onChange={(event) =>
                setExportSettings((prev) => ({
                  ...prev,
                  width: Number.parseInt(event.target.value, 10) || prev.width,
                }))
              }
              min={256}
              step={64}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: "8px 10px",
                fontSize: 12,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>Height</span>
            <input
              type="number"
              value={exportSettings.height}
              onChange={(event) =>
                setExportSettings((prev) => ({
                  ...prev,
                  height: Number.parseInt(event.target.value, 10) || prev.height,
                }))
              }
              min={256}
              step={64}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: "8px 10px",
                fontSize: 12,
              }}
            />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>FPS</span>
            <input
              type="number"
              value={exportSettings.fps}
              onChange={(event) =>
                setExportSettings((prev) => ({
                  ...prev,
                  fps: Number.parseInt(event.target.value, 10) || prev.fps,
                }))
              }
              min={1}
              step={1}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: "8px 10px",
                fontSize: 12,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>Camera preset</span>
            <input
              value={exportSettings.cameraPreset}
              onChange={(event) =>
                setExportSettings((prev) => ({
                  ...prev,
                  cameraPreset: event.target.value,
                }))
              }
              placeholder="Default"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: "8px 10px",
                fontSize: 12,
              }}
            />
          </label>
        </div>

        <button
          type="button"
          disabled
          style={{
            borderRadius: 12,
            padding: "10px 16px",
            border: "1px solid #e5e7eb",
            background: "#f3f4f6",
            color: "#9ca3af",
            cursor: "not-allowed",
            fontWeight: 600,
          }}
        >
          Export video
        </button>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>后端待实现</div>
      </div>
    );
  };

  if (!isDone) {
    return null;
  }

  return (
    <section
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 16,
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Results</div>

      <div style={{ display: "flex", gap: 8 }}>
        {(["preview", "assets", "export"] as TabKey[]).map((tab) => {
          const isActive = activeTab === tab;
          const label =
            tab === "preview" ? "Preview" : tab === "assets" ? "Assets" : "Export";
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                borderRadius: 999,
                padding: "6px 12px",
                border: `1px solid ${isActive ? "#111827" : "#e5e7eb"}`,
                background: isActive ? "#111827" : "#ffffff",
                color: isActive ? "#f9fafb" : "#111827",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div
          style={{
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            borderRadius: 12,
            padding: 10,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      {activeTab === "preview" ? renderPreviewTab() : null}
      {activeTab === "assets" ? renderAssetsTab() : null}
      {activeTab === "export" ? renderExportTab() : null}
    </section>
  );
};
