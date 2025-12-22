import { useState } from "react";

import { PreviewPanel } from "../components/preview/PreviewPanel";
import "./pages.css";

const steps = [
  { id: "prompt", label: "Step 1: Prompt" },
  { id: "options", label: "Step 2: Options" },
  { id: "preview", label: "Step 3: Preview" },
];

export const CreatePage = () => {
  const [activeStep, setActiveStep] = useState("preview");
  const [jobIdInput, setJobIdInput] = useState("");
  const [jobId, setJobId] = useState("");

  const applyJobId = () => {
    setJobId(jobIdInput.trim());
  };

  return (
    <div className="page create-page">
      <header className="page-header">
        <h1 className="page-title">Create</h1>
        <p className="page-subtitle">Load a preview config for the 3D player.</p>
      </header>
      <nav className="step-nav">
        {steps.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`step-button ${activeStep === step.id ? "active" : ""}`}
            onClick={() => setActiveStep(step.id)}
          >
            {step.label}
          </button>
        ))}
      </nav>
      <div className="step-content">
        {activeStep === "preview" ? (
          <>
            <div className="field-row">
              <label className="field-label" htmlFor="create-job-id">
                Job ID
              </label>
              <input
                id="create-job-id"
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
          </>
        ) : (
          <div className="step-placeholder">
            This step is stubbed to focus on the preview player.
          </div>
        )}
      </div>
    </div>
  );
};
