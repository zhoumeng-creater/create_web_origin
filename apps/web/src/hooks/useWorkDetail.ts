import { useCallback, useEffect, useState } from "react";

import { fetchManifest, fetchPreviewConfig } from "../lib/api";
import type { Manifest } from "../types/manifest";
import type { PreviewConfig } from "../types/previewConfig";

type LoadState<T> = {
  status: "idle" | "loading" | "ready" | "error";
  data?: T;
  error?: string;
  notFound?: boolean;
};

type WorkDetailResult = {
  manifest: LoadState<Manifest>;
  preview: LoadState<PreviewConfig>;
  reload: () => void;
};

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return fallback;
};

const getErrorStatus = (error: unknown): number | undefined => {
  if (error && typeof error === "object") {
    const status = (error as { status?: number }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  return undefined;
};

const isNotFoundError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  if (status === 404) {
    return true;
  }
  if (error instanceof Error && /not found|404/i.test(error.message)) {
    return true;
  }
  return false;
};

export const useWorkDetail = (jobId?: string | null): WorkDetailResult => {
  const [manifest, setManifest] = useState<LoadState<Manifest>>({ status: "idle" });
  const [preview, setPreview] = useState<LoadState<PreviewConfig>>({ status: "idle" });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!jobId) {
      setManifest({ status: "idle" });
      setPreview({ status: "idle" });
      return;
    }

    let cancelled = false;
    setManifest({ status: "loading" });
    setPreview({ status: "loading" });

    Promise.allSettled([fetchManifest(jobId), fetchPreviewConfig(jobId)]).then(
      ([manifestResult, previewResult]) => {
        if (cancelled) {
          return;
        }
        if (manifestResult.status === "fulfilled") {
          setManifest({ status: "ready", data: manifestResult.value });
        } else {
          setManifest({
            status: "error",
            error: toErrorMessage(manifestResult.reason, "Failed to load manifest."),
            notFound: isNotFoundError(manifestResult.reason),
          });
        }

        if (previewResult.status === "fulfilled") {
          setPreview({ status: "ready", data: previewResult.value });
        } else {
          setPreview({
            status: "error",
            error: toErrorMessage(previewResult.reason, "Failed to load preview config."),
          });
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [jobId, reloadToken]);

  return { manifest, preview, reload };
};
