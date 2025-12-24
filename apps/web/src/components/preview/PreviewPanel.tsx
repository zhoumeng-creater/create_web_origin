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
  emptyMessage = "请输入任务 ID 加载预览。",
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
    return <div className="preview-panel-state">正在加载预览配置...</div>;
  }

  if (resolvedError) {
    return (
      <div className="preview-panel-state">
        <div className="preview-panel-title">预览配置加载失败</div>
        <div className="preview-panel-message">{resolvedError}</div>
        <button type="button" onClick={retryHandler}>
          重试
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
