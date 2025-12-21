import { JobStatus } from "../../types/job";

type InspectorStep2Props = {
  jobId: string | null;
  status: JobStatus | null;
  logs: string[];
  errorMessage: string | null;
  isSubmitting: boolean;
  onRetry: () => void;
};

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

export const InspectorStep2 = ({
  jobId,
  status,
  logs,
  errorMessage,
  isSubmitting,
  onRetry,
}: InspectorStep2Props) => {
  const queuePosition = toNumber(
    status?.queue_position ?? status?.queue_rank ?? status?.queue_index ?? status?.queue
  );
  const stageLabel = status?.stage ?? status?.status ?? "--";
  const progressValue =
    typeof status?.progress === "number" && Number.isFinite(status.progress)
      ? Math.max(0, Math.min(100, status.progress))
      : 0;
  const isFailed = status?.status === "FAILED" || status?.stage === "FAILED";
  const resolvedError = isFailed
    ? errorMessage ?? status?.message ?? "Job failed"
    : null;

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
      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Pipeline</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Queue: {queuePosition !== undefined ? `#${queuePosition}` : "--"}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Stage: {stageLabel}</div>
        {jobId ? (
          <div style={{ fontSize: 11, color: "#9ca3af" }}>Job ID: {jobId}</div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>
          Progress {progressValue}%
        </div>
        <div
          style={{
            height: 8,
            borderRadius: 999,
            background: "rgba(15, 23, 42, 0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progressValue}%`,
              height: "100%",
              background: "#111827",
              opacity: 0.6,
              transition: "width 200ms ease",
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Latest logs</div>
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 10,
            background: "#f9fafb",
            fontSize: 11,
            color: "#6b7280",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            minHeight: 54,
          }}
        >
          {logs.length === 0 ? (
            <div>No logs yet.</div>
          ) : (
            logs.map((line, index) => (
              <div key={`${index}-${line}`}>{line}</div>
            ))
          )}
        </div>
      </div>

      {resolvedError ? (
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
          {resolvedError}
        </div>
      ) : null}

      {isFailed ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={isSubmitting}
          style={{
            borderRadius: 12,
            padding: "10px 16px",
            border: "1px solid #111827",
            background: isSubmitting ? "#e5e7eb" : "#ffffff",
            color: isSubmitting ? "#9ca3af" : "#111827",
            cursor: isSubmitting ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          Retry
        </button>
      ) : null}
    </section>
  );
};
