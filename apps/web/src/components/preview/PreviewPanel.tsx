import { useMemo } from "react";

import { usePreviewConfig } from "../../hooks/usePreviewConfig";
import type { PreviewConfig } from "../../types/previewConfig";
import { ThreePreviewPlayer } from "./ThreePreviewPlayer";
import "./preview.css";

type PreviewPanelProps = {
  jobId?: string | null;
  config?: PreviewConfig | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage?: string;
};

export const PreviewPanel = ({
  jobId,
  config,
  loading,
  error,
  onRetry,
  emptyMessage = "Enter a job id to load preview.",
}: PreviewPanelProps) => {
  const trimmedJobId = useMemo(() => jobId?.trim(), [jobId]);
  const effectiveJobId = config ? null : trimmedJobId;
  const { status, data, error: hookError, reload } = usePreviewConfig(effectiveJobId);
  const resolvedConfig = config ?? data;
  const resolvedLoading = loading ?? status === "loading";
  const resolvedError = error ?? (status === "error" ? hookError : undefined);
  const retryHandler = onRetry ?? reload;

  if (!resolvedConfig && !effectiveJobId && !resolvedLoading && !resolvedError) {
    return <div className="preview-panel-state">{emptyMessage}</div>;
  }

  if (resolvedLoading) {
    return <div className="preview-panel-state">Loading preview config...</div>;
  }

  if (resolvedError) {
    return (
      <div className="preview-panel-state">
        <div className="preview-panel-title">Preview config failed</div>
        <div className="preview-panel-message">{resolvedError}</div>
        <button type="button" onClick={retryHandler}>
          Retry
        </button>
      </div>
    );
  }

  if (!resolvedConfig) {
    return null;
  }

  return (
    <div className="preview-panel">
      <ThreePreviewPlayer config={resolvedConfig} />
    </div>
  );
};
