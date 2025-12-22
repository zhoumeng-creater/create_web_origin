import { useCallback, useEffect, useState } from "react";

import { fetchPreviewConfig } from "../lib/api";
import type { PreviewConfig } from "../types/previewConfig";

type PreviewConfigState =
  | { status: "idle"; data?: undefined; error?: undefined }
  | { status: "loading"; data?: PreviewConfig; error?: undefined }
  | { status: "ready"; data: PreviewConfig; error?: undefined }
  | { status: "error"; data?: undefined; error: string };

type PreviewConfigResult = PreviewConfigState & {
  reload: () => void;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Failed to load preview config.";
};

export const usePreviewConfig = (jobId?: string | null): PreviewConfigResult => {
  const [state, setState] = useState<PreviewConfigState>(() =>
    jobId ? { status: "loading" } : { status: "idle" }
  );
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!jobId) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    fetchPreviewConfig(jobId)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setState({ status: "ready", data });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setState({ status: "error", error: toErrorMessage(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, reloadToken]);

  return { ...state, reload };
};
