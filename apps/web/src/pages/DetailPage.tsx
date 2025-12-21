import { useEffect, useState } from "react";

import { PreviewPanel } from "../components/preview/PreviewPanel";
import "./pages.css";

type DetailPageProps = {
  jobId?: string;
};

export const DetailPage = ({ jobId: initialJobId }: DetailPageProps) => {
  const [jobIdInput, setJobIdInput] = useState(initialJobId ?? "");
  const [jobId, setJobId] = useState(initialJobId ?? "");

  useEffect(() => {
    if (initialJobId) {
      setJobIdInput(initialJobId);
      setJobId(initialJobId);
    }
  }, [initialJobId]);

  const applyJobId = () => {
    setJobId(jobIdInput.trim());
  };

  return (
    <div className="page detail-page">
      <header className="page-header">
        <h1 className="page-title">Work Detail</h1>
        <p className="page-subtitle">Preview assets for a specific job.</p>
      </header>
      <div className="field-row">
        <label className="field-label" htmlFor="detail-job-id">
          Job ID
        </label>
        <input
          id="detail-job-id"
          className="field-input"
          placeholder="job_1001"
          value={jobIdInput}
          onChange={(event) => setJobIdInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              applyJobId();
            }
          }}
        />
        <button type="button" className="field-button" onClick={applyJobId}>
          Load preview
        </button>
      </div>
      <PreviewPanel jobId={jobId} />
    </div>
  );
};
