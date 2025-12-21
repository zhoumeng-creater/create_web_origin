import { useEffect, useState } from "react";

import { JobStatus } from "../../types/job";
import { CreateJobOptions, createDefaultOptions } from "../../types/options";
import { InspectorStep1 } from "./InspectorStep1";
import { InspectorStep2 } from "./InspectorStep2";
import { InspectorStep3 } from "./InspectorStep3";

type InspectorPanelProps = {
  status: JobStatus | null;
  logs: string[];
  errorMessage: string | null;
  jobId: string | null;
  pendingPrompt: string | null;
  isSubmitting: boolean;
  onConfirm: () => void;
  onRetry: () => void;
  onClear: () => void;
  onOptionsChange: (next: CreateJobOptions) => void;
};

export const InspectorPanel = ({
  status,
  logs,
  errorMessage,
  jobId,
  pendingPrompt,
  isSubmitting,
  onConfirm,
  onRetry,
  onClear,
  onOptionsChange,
}: InspectorPanelProps) => {
  const [draftOptions, setDraftOptions] = useState<CreateJobOptions>(createDefaultOptions);
  const step1Visible = Boolean(pendingPrompt);
  const step2Visible = Boolean(jobId || status);
  const step3Visible =
    Boolean(jobId) && (status?.status === "DONE" || status?.stage === "DONE");

  useEffect(() => {
    onOptionsChange(draftOptions);
  }, [draftOptions, onOptionsChange]);

  useEffect(() => {
    if (pendingPrompt) {
      setDraftOptions(createDefaultOptions());
    }
  }, [pendingPrompt]);

  return (
    <aside
      style={{
        flex: "0 1 320px",
        minWidth: 240,
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 20,
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>Inspector</div>

      <div
        aria-hidden={!step1Visible}
        style={{
          maxHeight: step1Visible ? 1200 : 0,
          opacity: step1Visible ? 1 : 0,
          transform: step1Visible ? "translateY(0)" : "translateY(-6px)",
          transition: "max-height 260ms ease, opacity 200ms ease, transform 260ms ease",
          overflow: "hidden",
          pointerEvents: step1Visible ? "auto" : "none",
        }}
      >
        <InspectorStep1
          prompt={pendingPrompt ?? ""}
          draftOptions={draftOptions}
          onDraftChange={setDraftOptions}
          onConfirm={onConfirm}
          isSubmitting={isSubmitting}
        />
      </div>

      <div
        aria-hidden={!step2Visible}
        style={{
          maxHeight: step2Visible ? 1200 : 0,
          opacity: step2Visible ? 1 : 0,
          transform: step2Visible ? "translateY(0)" : "translateY(-6px)",
          transition: "max-height 260ms ease, opacity 200ms ease, transform 260ms ease",
          overflow: "hidden",
          pointerEvents: step2Visible ? "auto" : "none",
        }}
      >
        <InspectorStep2
          jobId={jobId}
          status={status}
          logs={logs}
          errorMessage={errorMessage}
          isSubmitting={isSubmitting}
          onRetry={onRetry}
        />
      </div>

      <div
        aria-hidden={!step3Visible}
        style={{
          maxHeight: step3Visible ? 1600 : 0,
          opacity: step3Visible ? 1 : 0,
          transform: step3Visible ? "translateY(0)" : "translateY(-6px)",
          transition: "max-height 260ms ease, opacity 200ms ease, transform 260ms ease",
          overflow: "hidden",
          pointerEvents: step3Visible ? "auto" : "none",
        }}
      >
        <InspectorStep3 jobId={jobId} isDone={step3Visible} />
      </div>

      <div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Options</div>
        <div style={{ fontSize: 12, color: "#9ca3af", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(draftOptions, null, 2)}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onClear}
          style={{
            borderRadius: 10,
            padding: "8px 12px",
            border: "1px solid #e5e7eb",
            background: "#ffffff",
            cursor: "pointer",
          }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => setDraftOptions(createDefaultOptions())}
          style={{
            borderRadius: 10,
            padding: "8px 12px",
            border: "1px solid #e5e7eb",
            background: "#ffffff",
            cursor: "pointer",
          }}
        >
          Reset Options
        </button>
      </div>
    </aside>
  );
};
