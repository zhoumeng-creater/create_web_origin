import { useCallback, useEffect, useRef, useState } from "react";

import { createJob, getJob, subscribeJobEvents } from "../lib/api";
import type { JobEvent, JobStatus } from "../types/job";
import type { CreateJobOptions } from "../types/options";

type ConnectionState = "idle" | "connecting" | "connected" | "disconnected";

type JobRunnerState = {
  jobId: string | null;
  jobStatus: JobStatus | null;
  connectionState: ConnectionState;
  error: string | null;
  isStarting: boolean;
  start: () => Promise<void>;
  stop: () => void;
};

const MAX_LOG_LINES = 8;

const toNumber = (value: unknown): number | undefined =>
  typeof value === "number" && !Number.isNaN(value) ? value : undefined;

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const extractLogsTail = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const lines = value.filter((line) => typeof line === "string");
  return lines.length > 0 ? lines : undefined;
};

const extractEventInfo = (data: unknown) => {
  if (typeof data === "string") {
    return { message: data };
  }
  const record = toRecord(data);
  if (!record) {
    return {};
  }
  return {
    progress:
      toNumber(record.progress) ??
      toNumber(record.percent) ??
      toNumber(record.pct),
    stage: toString(record.stage) ?? toString(record.status) ?? toString(record.phase),
    message:
      toString(record.message) ??
      toString(record.text) ??
      toString(record.hint) ??
      toString(record.error),
    logsTail: extractLogsTail(record.logs_tail) ?? extractLogsTail(record.hints),
    queue_position:
      toNumber(record.queue_position) ??
      toNumber(record.queuePosition) ??
      toNumber(record.queue_index) ??
      toNumber(record.queueIndex) ??
      toNumber(record.queue),
    preview_url: toString(record.preview_url),
    audio_url: toString(record.audio_url),
    bvh_download_url: toString(record.bvh_download_url ?? record.download_url),
    mp4_list: Array.isArray(record.mp4_list)
      ? record.mp4_list.filter((item) => typeof item === "string")
      : undefined,
    zip_url: toString(record.zip_url),
  };
};

const mergeLogs = (
  existing: string[] | undefined,
  incoming: string[] | undefined,
  message?: string
): string[] | undefined => {
  const base = incoming && incoming.length > 0 ? [...incoming] : [...(existing ?? [])];
  if (message && (base.length === 0 || base[base.length - 1] !== message)) {
    base.push(message);
  }
  if (base.length > MAX_LOG_LINES) {
    base.splice(0, base.length - MAX_LOG_LINES);
  }
  return base.length > 0 ? base : undefined;
};

const applyEventToStatus = (prev: JobStatus | null, event: JobEvent): JobStatus => {
  const base: JobStatus = prev ?? { status: "RUNNING" };
  const info = extractEventInfo(event.data);
  const next: JobStatus = { ...base };

  if (info.preview_url) {
    next.preview_url = info.preview_url;
  }
  if (info.queue_position !== undefined) {
    next.queue_position = info.queue_position;
  }
  if (info.audio_url) {
    next.audio_url = info.audio_url;
  }
  if (info.bvh_download_url) {
    next.bvh_download_url = info.bvh_download_url;
  }
  if (info.mp4_list && info.mp4_list.length > 0) {
    next.mp4_list = info.mp4_list;
  }
  if (info.zip_url) {
    next.zip_url = info.zip_url;
  }

  switch (event.type) {
    case "progress":
    case "stage":
      if (base.status === "QUEUED") {
        next.status = "RUNNING";
      }
      if (info.progress !== undefined) {
        next.progress = info.progress;
      }
      if (info.stage) {
        next.stage = info.stage;
      }
      if (info.message) {
        next.message = info.message;
      }
      if (info.logsTail) {
        next.logs_tail = info.logsTail;
      }
      break;
    case "log":
      if (base.status === "QUEUED") {
        next.status = "RUNNING";
      }
      next.logs_tail = mergeLogs(base.logs_tail, info.logsTail, info.message);
      if (info.message) {
        next.message = info.message;
      }
      break;
    case "done":
      next.status = "DONE";
      next.stage = info.stage ?? "DONE";
      next.progress = info.progress ?? 100;
      if (info.message) {
        next.message = info.message;
      }
      if (info.logsTail) {
        next.logs_tail = info.logsTail;
      }
      break;
    case "error":
      next.status = "ERROR";
      if (info.message) {
        next.message = info.message;
      }
      if (info.logsTail) {
        next.logs_tail = info.logsTail;
      }
      break;
  }

  return next;
};

const mergePolledStatus = (prev: JobStatus | null, next: JobStatus): JobStatus => {
  const merged: JobStatus = { ...(prev ?? { status: next.status }), ...next };
  if (next.progress === undefined && prev?.progress !== undefined) {
    merged.progress = prev.progress;
  }
  if (next.queue_position === undefined && prev?.queue_position !== undefined) {
    merged.queue_position = prev.queue_position;
  }
  if (!next.stage && prev?.stage) {
    merged.stage = prev.stage;
  }
  if (!next.message && prev?.message) {
    merged.message = prev.message;
  }
  if (!next.logs_tail && prev?.logs_tail) {
    merged.logs_tail = prev.logs_tail;
  }
  return merged;
};

const isTerminalStatus = (status?: string): boolean => {
  if (!status) {
    return false;
  }
  const normalized = status.toUpperCase();
  return (
    normalized === "DONE" ||
    normalized === "COMPLETED" ||
    normalized === "FAILED" ||
    normalized === "ERROR"
  );
};

export const useJobRunner = (
  prompt: string,
  options: Record<string, unknown> | CreateJobOptions = {}
): JobRunnerState => {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const subscriptionRef = useRef<{ close: () => void } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      globalThis.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    subscriptionRef.current?.close();
    subscriptionRef.current = null;
    stopPolling();
    setConnectionState("idle");
  }, [stopPolling]);

  const handleEvent = useCallback((event: JobEvent) => {
    setJobStatus((prev) => applyEventToStatus(prev, event));
    if (event.type === "error") {
      const info = extractEventInfo(event.data);
      if (info.message) {
        setError(info.message);
      }
    }
  }, []);

  const startPolling = useCallback(
    (activeJobId: string, token: number) => {
      if (pollTimerRef.current !== null) {
        return;
      }
      pollTimerRef.current = globalThis.setInterval(async () => {
        if (tokenRef.current !== token) {
          return;
        }
        try {
          const status = await getJob(activeJobId);
          setJobStatus((prev) => mergePolledStatus(prev, status));
          if (isTerminalStatus(status.status)) {
            stop();
          }
        } catch {
          // Ignore polling errors; SSE/WS may reconnect.
        }
      }, 2000);
    },
    [stop]
  );

  const start = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError("Prompt is empty");
      return;
    }
    stop();
    setIsStarting(true);
    setError(null);
    setJobStatus({ status: "QUEUED", progress: 0, stage: "QUEUED" });
    setJobId(null);
    setConnectionState("connecting");
    tokenRef.current += 1;
    const token = tokenRef.current;

    try {
      const response = await createJob(trimmed, options);
      setJobId(response.job_id);
      subscriptionRef.current = subscribeJobEvents(
        response.job_id,
        (event) => {
          if (tokenRef.current !== token) {
            return;
          }
          handleEvent(event);
        },
        {
          onConnectionChange: (state) => {
            if (tokenRef.current !== token) {
              return;
            }
            setConnectionState(state);
          },
        }
      );
    } catch (err) {
      setConnectionState("idle");
      const message = err instanceof Error ? err.message : "Failed to create job";
      setError(message);
      setJobStatus({ status: "ERROR", message });
      throw err;
    } finally {
      setIsStarting(false);
    }
  }, [handleEvent, options, prompt, stop]);

  useEffect(() => {
    if (!jobId) {
      stopPolling();
      return;
    }
    if (connectionState === "disconnected") {
      startPolling(jobId, tokenRef.current);
    } else {
      stopPolling();
    }
  }, [connectionState, jobId, startPolling, stopPolling]);

  useEffect(() => {
    if (jobStatus && isTerminalStatus(jobStatus.status)) {
      stop();
    }
  }, [jobStatus, stop]);

  useEffect(() => () => stop(), [stop]);

  return {
    jobId,
    jobStatus,
    connectionState,
    error,
    isStarting,
    start,
    stop,
  };
};
