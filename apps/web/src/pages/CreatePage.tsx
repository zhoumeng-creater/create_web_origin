import { useEffect, useRef, useState } from "react";

import { ChatList } from "../components/chat/ChatList";
import { Composer } from "../components/chat/Composer";
import { ChatMessage } from "../components/chat/MessageBubble";
import { InspectorPanel } from "../components/inspector/InspectorPanel";
import { useJobRunner } from "../hooks/useJobRunner";
import { saveRecentWork } from "../lib/storage";
import { CreateJobOptions, createDefaultOptions } from "../types/options";

const templates = [
  { id: "action", label: "Action", text: "Action: describe the motion and timing.\n" },
  { id: "camera", label: "Camera", text: "Camera: movement, framing, speed.\n" },
  { id: "mood", label: "Mood", text: "Mood: lighting, palette, emotion tags.\n" },
  { id: "duration", label: "Duration", text: "Duration: 10s (adjustable)\n" },
];

const formatProgressMessage = (status: {
  status?: string;
  stage?: string;
  progress?: number;
  message?: string;
}): string => {
  const parts: string[] = [];
  if (status.stage || status.status) {
    parts.push(status.stage ?? status.status ?? "RUNNING");
  }
  if (typeof status.progress === "number") {
    parts.push(`${Math.round(status.progress)}%`);
  }
  if (status.message) {
    parts.push(status.message);
  }
  return parts.length > 0 ? parts.join(" - ") : "Working...";
};

export const CreatePage = () => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "system-welcome",
      role: "system",
      content: "Describe the scene, motion, and music you want to create.",
    },
  ]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [lastSubmittedPrompt, setLastSubmittedPrompt] = useState<string | null>(null);
  const [draftOptions, setDraftOptions] = useState<CreateJobOptions>(createDefaultOptions);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pendingToolId = useRef<string | null>(null);
  const notifiedRef = useRef<{ doneJobId: string | null; failedJobId: string | null }>({
    doneJobId: null,
    failedJobId: null,
  });

  const { jobId, status, logs, errorMessage, startJob, retryJob, clearJob } = useJobRunner();

  const upsertToolMessage = (jobId: string, update: Partial<ChatMessage>) => {
    setMessages((prev) => {
      const index = prev.findIndex((item) => item.role === "tool" && item.jobId === jobId);
      if (index === -1) {
        return [
          ...prev,
          {
            id: `tool-${jobId}`,
            role: "tool",
            jobId,
            content: update.content ?? "Working...",
            progress: update.progress,
            stage: update.stage,
          },
        ];
      }
      const next = prev.slice();
      next[index] = {
        ...next[index],
        ...update,
      };
      return next;
    });
  };

  const appendMessage = (message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isSubmitting) {
      return;
    }
    const timestamp = Date.now();
    setMessages((prev) => [...prev, { id: `user-${timestamp}`, role: "user", content: trimmed }]);
    setInput("");
    setPendingPrompt(trimmed);
  };

  const handleConfirm = async () => {
    if (!pendingPrompt || isSubmitting) {
      return;
    }
    const prompt = pendingPrompt;
    setIsSubmitting(true);
    const timestamp = Date.now();
    const toolMessageId = `tool-${timestamp}`;
    pendingToolId.current = toolMessageId;

    setMessages((prev) => [...prev, { id: toolMessageId, role: "tool", content: "Planning..." }]);

    try {
      const nextJobId = await startJob(prompt, draftOptions);
      saveRecentWork(nextJobId, {
        title: prompt.slice(0, 60),
        createdAt: new Date().toISOString(),
      });
      if (pendingToolId.current) {
        setMessages((prev) =>
          prev.map((item) =>
            item.id === pendingToolId.current ? { ...item, jobId: nextJobId } : item
          )
        );
        pendingToolId.current = null;
      }
      setLastSubmittedPrompt(prompt);
      setPendingPrompt(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create job.";
      setMessages((prev) =>
        prev.map((item) =>
          item.id === pendingToolId.current
            ? { ...item, role: "system", content: `Error: ${message}` }
            : item
        )
      );
      pendingToolId.current = null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = async () => {
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    const timestamp = Date.now();
    const toolMessageId = `tool-${timestamp}`;
    pendingToolId.current = toolMessageId;
    setMessages((prev) => [...prev, { id: toolMessageId, role: "tool", content: "Retrying..." }]);

    try {
      const nextJobId = await retryJob();
      if (!nextJobId) {
        throw new Error("No previous job to retry.");
      }
      if (lastSubmittedPrompt) {
        saveRecentWork(nextJobId, {
          title: lastSubmittedPrompt.slice(0, 60),
          createdAt: new Date().toISOString(),
        });
      }
      if (pendingToolId.current) {
        setMessages((prev) =>
          prev.map((item) =>
            item.id === pendingToolId.current ? { ...item, jobId: nextJobId } : item
          )
        );
        pendingToolId.current = null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to retry job.";
      setMessages((prev) =>
        prev.map((item) =>
          item.id === pendingToolId.current
            ? { ...item, role: "system", content: `Error: ${message}` }
            : item
        )
      );
      pendingToolId.current = null;
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!jobId || !status) {
      return;
    }
    upsertToolMessage(jobId, {
      content: formatProgressMessage(status),
      progress: status.progress,
      stage: status.stage ?? status.status,
    });

    if (status.status === "DONE" && notifiedRef.current.doneJobId !== jobId) {
      notifiedRef.current.doneJobId = jobId;
      appendMessage({
        id: `result-${Date.now()}`,
        role: "result",
        content: "Job completed. Open it in Library or visit the detail page.",
      });
    }

    if (status.status === "FAILED" && notifiedRef.current.failedJobId !== jobId) {
      notifiedRef.current.failedJobId = jobId;
      appendMessage({
        id: `error-${Date.now()}`,
        role: "system",
        content: errorMessage
          ? `Generation failed: ${errorMessage}`
          : "Generation failed. Check logs or try again.",
      });
    }
  }, [errorMessage, jobId, status]);

  const handleClearJob = () => {
    setPendingPrompt(null);
    setLastSubmittedPrompt(null);
    notifiedRef.current = { doneJobId: null, failedJobId: null };
    clearJob();
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
      <section
        style={{
          flex: "1 1 520px",
          minWidth: 280,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 28, color: "#111827" }}>Create</h1>
          <p style={{ margin: 0, color: "#6b7280" }}>
            Draft prompts and track progress in the chat stream.
          </p>
        </header>

        <ChatList messages={messages} />
        <Composer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={isSubmitting}
          templates={templates}
        />
      </section>

      <InspectorPanel
        status={status}
        logs={logs}
        errorMessage={errorMessage}
        jobId={jobId}
        pendingPrompt={pendingPrompt}
        isSubmitting={isSubmitting}
        onConfirm={handleConfirm}
        onRetry={handleRetry}
        onClear={handleClearJob}
        onOptionsChange={setDraftOptions}
      />
    </div>
  );
};
