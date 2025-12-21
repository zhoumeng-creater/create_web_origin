import { useEffect, useState } from "react";

import { fetchManifest, fetchPreviewConfig } from "../lib/api";
import { Manifest } from "../types/manifest";
import { PreviewConfig } from "../types/previewConfig";

type JobArtifacts = {
  manifest: Manifest | null;
  previewConfig: PreviewConfig | null;
  error: string | null;
};

type JobArtifactsState = JobArtifacts & { isLoading: boolean };

const cache = new Map<string, JobArtifacts>();

const errorToMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to load assets.";
};

export const useJobArtifacts = (jobId: string | null, enabled: boolean) => {
  const [state, setState] = useState<JobArtifactsState>({
    manifest: null,
    previewConfig: null,
    error: null,
    isLoading: false,
  });

  useEffect(() => {
    if (!jobId || !enabled) {
      return;
    }
    const cached = cache.get(jobId);
    if (cached) {
      setState({ ...cached, isLoading: false });
      return;
    }
    let cancelled = false;
    setState({
      manifest: null,
      previewConfig: null,
      error: null,
      isLoading: true,
    });

    const load = async () => {
      const [manifestResult, previewResult] = await Promise.allSettled([
        fetchManifest(jobId),
        fetchPreviewConfig(jobId),
      ]);
      if (cancelled) {
        return;
      }
      const manifest = manifestResult.status === "fulfilled" ? manifestResult.value : null;
      const previewConfig = previewResult.status === "fulfilled" ? previewResult.value : null;
      const errors: string[] = [];
      if (manifestResult.status === "rejected") {
        errors.push(errorToMessage(manifestResult.reason));
      }
      if (previewResult.status === "rejected") {
        errors.push(errorToMessage(previewResult.reason));
      }
      const next: JobArtifacts = {
        manifest,
        previewConfig,
        error: errors.length > 0 ? errors.join(" / ") : null,
      };
      cache.set(jobId, next);
      setState({ ...next, isLoading: false });
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [enabled, jobId]);

  useEffect(() => {
    if (jobId) {
      return;
    }
    setState({
      manifest: null,
      previewConfig: null,
      error: null,
      isLoading: false,
    });
  }, [jobId]);

  return state;
};
