import { useCallback, useEffect, useRef, useState } from "react";

import { createJob, getJob, subscribeJobEvents } from "../lib/api";
import { JobEvent, JobStatus } from "../types/job";
import { CreateJobOptions } from "../types/options";

const POLL_INTERVAL_MS = 2000;
const CONNECTION_ERROR_MESSAGE = "SSE connection error";

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

const extractLogText = (data: unknown): string | undefined => {
  if (typeof data === "string") {
    return data;
  }
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.message === "string") {
    return record.message;
  }
  if (typeof record.detail === "string") {
    return record.detail;
  }
  const nested = record.payload;
  if (nested && typeof nested === "object") {
    const nestedRecord = nested as Record<string, unknown>;
    if (typeof nestedRecord.text === "string") {
      return nestedRecord.text;
    }
    if (typeof nestedRecord.detail === "string") {
      return nestedRecord.detail;
    }
  }
  return undefined;
};

const extractErrorMessage = (data: unknown): string => {
  const text = extractLogText(data);
  if (text && text.trim()) {
    return text;
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
  }
  return "Job failed";
};

type StatusPatch = {
  status?: string;
  stage?: string;
  progress?: number;
  message?: string;
  queuePosition?: number;
};

const extractStatusPatch = (event: JobEvent): StatusPatch => {
  if (!event.data || typeof event.data !== "object") {
    return {};
  }
  const payload = event.data as Record<string, unknown>;
  const progress = toNumber(payload.progress);
  const stage = typeof payload.stage === "string" ? payload.stage : undefined;
  const status = typeof payload.status === "string" ? payload.status : undefined;
  const message = typeof payload.message === "string" ? payload.message : undefined;
  const queuePosition = toNumber(
    payload.queue_position ?? payload.queue ?? payload.queue_rank ?? payload.queue_index
  );
  const nestedPayload = payload.payload;
  if (nestedPayload && typeof nestedPayload === "object") {
    const nested = nestedPayload as Record<string, unknown>;
    const logText =
      typeof nested.text === "string"
        ? nested.text
        : typeof nested.detail === "string"
          ? nested.detail
          : undefined;
    return {
      status,
      stage,
      progress,
      message: message ?? logText,
      queuePosition,
    };
  }
  return { status, stage, progress, message, queuePosition };
};

export const useJobRunner = () => {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const lastPromptRef = useRef<string | null>(null);
  const lastOptionsRef = useRef<CreateJobOptions | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const subscriptionRef = useRef<{ close: () => void } | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      globalThis.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const applyStatus = useCallback((patch: StatusPatch) => {
    setStatus((prev) => {
      const base: JobStatus = prev ?? {
        status: patch.status ?? patch.stage ?? "RUNNING",
      };
      return {
        ...base,
        status: patch.status ?? patch.stage ?? base.status,
        stage: patch.stage ?? base.stage,
        progress: patch.progress ?? base.progress,
        message: patch.message ?? base.message,
        queue_position: patch.queuePosition ?? base.queue_position,
      };
    });
  }, []);

  const pushLog = useCallback((text: string) => {
    setLogs((prev) => {
      const next = [...prev, text].slice(-3);
      return next;
    });
  }, []);

  const applyJobStatus = useCallback((nextStatus: JobStatus) => {
    setStatus(nextStatus);
    if (nextStatus.logs_tail && nextStatus.logs_tail.length > 0) {
      setLogs(nextStatus.logs_tail.slice(-3));
    }
    if (nextStatus.status === "FAILED") {
      setErrorMessage(nextStatus.message ?? "Job failed");
    }
  }, []);

  const startPolling = useCallback(
    (activeJobId: string) => {
      if (pollTimerRef.current) {
        return;
      }
      setIsPolling(true);
      const pollOnce = async () => {
        if (pollInFlightRef.current) {
          return;
        }
        pollInFlightRef.current = true;
        try {
          const result = await getJob(activeJobId);
          applyJobStatus(result);
          if (result.status === "DONE" || result.status === "FAILED") {
            stopPolling();
          }
        } catch {
          // Ignore polling errors, keep retrying.
        } finally {
          pollInFlightRef.current = false;
        }
      };
      pollOnce();
      pollTimerRef.current = globalThis.setInterval(pollOnce, POLL_INTERVAL_MS);
    },
    [applyJobStatus, stopPolling]
  );

  const clearJob = useCallback(() => {
    subscriptionRef.current?.close();
    subscriptionRef.current = null;
    stopPolling();
    setJobId(null);
    setStatus(null);
    setLogs([]);
    setErrorMessage(null);
  }, [stopPolling]);

  const startJob = useCallback(
    async (prompt: string, options: CreateJobOptions) => {
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
      stopPolling();
      setJobId(null);
      setStatus(null);
      setLogs([]);
      setErrorMessage(null);
      lastPromptRef.current = prompt;
      lastOptionsRef.current = options;

      const response = await createJob(prompt, options);
      setJobId(response.job_id);
      setStatus({
        status: "QUEUED",
        progress: 0,
        stage: "PLANNING",
        message: "Planning",
      });
      return response.job_id;
    },
    [stopPolling]
  );

  const retryJob = useCallback(async () => {
    if (!lastPromptRef.current || !lastOptionsRef.current) {
      return null;
    }
    return startJob(lastPromptRef.current, lastOptionsRef.current);
  }, [startJob]);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    const subscription = subscribeJobEvents(jobId, (event) => {
      if (event.type === "log") {
        stopPolling();
        const logText = extractLogText(event.data);
        if (logText) {
          pushLog(logText);
        }
        return;
      }

      if (event.type === "error") {
        const message = extractErrorMessage(event.data);
        if (message === CONNECTION_ERROR_MESSAGE) {
          startPolling(jobId);
          return;
        }
        setErrorMessage(message);
        applyStatus({
          status: "FAILED",
          stage: "FAILED",
          message,
        });
        stopPolling();
        return;
      }

      stopPolling();
      if (event.type === "done") {
        applyStatus({
          status: "DONE",
          stage: "DONE",
          progress: 100,
        });
        subscription.close();
        return;
      }

      const patch = extractStatusPatch(event);
      applyStatus(patch);
    });

    subscriptionRef.current = subscription;

    return () => {
      subscription.close();
      subscriptionRef.current = null;
      stopPolling();
    };
  }, [applyStatus, jobId, pushLog, startPolling, stopPolling]);

  return {
    jobId,
    status,
    logs,
    errorMessage,
    isPolling,
    startJob,
    retryJob,
    clearJob,
  };
};
