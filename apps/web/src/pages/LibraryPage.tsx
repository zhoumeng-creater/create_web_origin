import { useCallback, useEffect, useMemo, useState } from "react";

import { LibraryCommandBar } from "../components/library/LibraryCommandBar";
import { LibraryFilterDrawer } from "../components/library/LibraryFilterDrawer";
import type { FilterOption } from "../components/library/LibraryFilters";
import { WorkCard } from "../components/library/WorkCard";
import { useRecentWorks } from "../hooks/useRecentWorks";
import { fetchManifest } from "../lib/api";
import { removeWork } from "../lib/storage";
import type { Manifest } from "../types/manifest";
import "./pages.css";
import "../components/library/library.css";

type ManifestEntry =
  | { status: "loading" }
  | { status: "ready"; manifest: Manifest }
  | { status: "error"; error: string };

type WorkSummary = {
  jobId: string;
  title: string;
  prompt?: string;
  style?: string;
  duration?: number;
  status?: string;
  createdAt?: string;
  thumbnailUri?: string;
  loading?: boolean;
  error?: string;
};

const durationOptions: FilterOption[] = [
  { value: "any", label: "Any duration" },
  { value: "short", label: "0-10s" },
  { value: "medium", label: "10-30s" },
  { value: "long", label: "30s+" },
];

const dateOptions: FilterOption[] = [
  { value: "any", label: "Any date" },
  { value: "has", label: "Has date" },
  { value: "none", label: "No date" },
];

const truncate = (value: string, max = 64) =>
  value.length > max ? `${value.slice(0, max - 1)}...` : value;

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Failed to load manifest.";
};

const getDuration = (manifest?: Manifest): number | undefined =>
  manifest?.inputs?.duration_s ??
  manifest?.outputs?.motion?.duration_s ??
  manifest?.outputs?.music?.duration_s;

const matchesDuration = (duration: number | undefined, filter: string) => {
  if (filter === "any") {
    return true;
  }
  if (!Number.isFinite(duration)) {
    return false;
  }
  switch (filter) {
    case "short":
      return duration <= 10;
    case "medium":
      return duration > 10 && duration <= 30;
    case "long":
      return duration > 30;
    default:
      return true;
  }
};

export const LibraryPage = () => {
  const { items } = useRecentWorks();
  const [manifestMap, setManifestMap] = useState<Record<string, ManifestEntry>>({});
  const [query, setQuery] = useState("");
  const [styleFilter, setStyleFilter] = useState("all");
  const [durationFilter, setDurationFilter] = useState("any");
  const [dateFilter, setDateFilter] = useState("any");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const updateManifestMap = useCallback(
    (updater: (prev: Record<string, ManifestEntry>) => Record<string, ManifestEntry>) => {
      setManifestMap((prev) => updater(prev));
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    const currentIds = new Set(items.map((item) => item.jobId));
    updateManifestMap((prev) => {
      const next: Record<string, ManifestEntry> = {};
      let changed = false;
      for (const [jobId, entry] of Object.entries(prev)) {
        if (currentIds.has(jobId)) {
          next[jobId] = entry;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    items.forEach((item) => {
      const entry = manifestMap[item.jobId];
      if (entry) {
        return;
      }
      updateManifestMap((prev) => ({
        ...prev,
        [item.jobId]: { status: "loading" },
      }));
      fetchManifest(item.jobId)
        .then((manifest) => {
          if (cancelled) {
            return;
          }
          updateManifestMap((prev) => ({
            ...prev,
            [item.jobId]: { status: "ready", manifest },
          }));
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          updateManifestMap((prev) => ({
            ...prev,
            [item.jobId]: { status: "error", error: toErrorMessage(error) },
          }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [items, manifestMap, updateManifestMap]);

  const works = useMemo<WorkSummary[]>(() => {
    return items.map((item) => {
      const entry = manifestMap[item.jobId];
      const manifest = entry && entry.status === "ready" ? entry.manifest : undefined;
      const prompt = manifest?.inputs?.raw_prompt;
      const title = prompt ? truncate(prompt) : `Work ${item.jobId}`;
      return {
        jobId: item.jobId,
        title,
        prompt,
        style: manifest?.inputs?.style,
        duration: getDuration(manifest),
        status: manifest?.status,
        createdAt: manifest?.created_at ?? item.meta.createdAt,
        thumbnailUri: manifest?.outputs?.scene?.panorama?.uri,
        loading: entry?.status === "loading",
        error: entry?.status === "error" ? entry.error : undefined,
      };
    });
  }, [items, manifestMap]);

  const styleOptions = useMemo(() => {
    const styles = new Set<string>();
    let hasUnknown = false;
    works.forEach((work) => {
      if (work.style) {
        styles.add(work.style);
      } else {
        hasUnknown = true;
      }
    });
    const options = [{ value: "all", label: "All styles" }];
    Array.from(styles)
      .sort((a, b) => a.localeCompare(b))
      .forEach((style) => options.push({ value: style, label: style }));
    if (hasUnknown) {
      options.push({ value: "unknown", label: "Unknown" });
    }
    return options;
  }, [works]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; onClear: () => void }> = [];
    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      chips.push({
        id: "query",
        label: `Search: ${truncate(trimmedQuery, 32)}`,
        onClear: () => setQuery(""),
      });
    }
    if (styleFilter !== "all") {
      const styleLabel =
        styleOptions.find((option) => option.value === styleFilter)?.label ?? styleFilter;
      chips.push({
        id: "style",
        label: `Style: ${styleLabel}`,
        onClear: () => setStyleFilter("all"),
      });
    }
    if (durationFilter !== "any") {
      const durationLabel =
        durationOptions.find((option) => option.value === durationFilter)?.label ??
        durationFilter;
      chips.push({
        id: "duration",
        label: `Duration: ${durationLabel}`,
        onClear: () => setDurationFilter("any"),
      });
    }
    if (dateFilter !== "any") {
      const dateLabel =
        dateOptions.find((option) => option.value === dateFilter)?.label ?? dateFilter;
      chips.push({
        id: "date",
        label: `Date: ${dateLabel}`,
        onClear: () => setDateFilter("any"),
      });
    }
    return chips;
  }, [
    dateFilter,
    durationFilter,
    query,
    setDateFilter,
    setDurationFilter,
    setQuery,
    setStyleFilter,
    styleFilter,
    styleOptions,
  ]);

  const filterCount = useMemo(() => {
    let count = 0;
    if (styleFilter !== "all") {
      count += 1;
    }
    if (durationFilter !== "any") {
      count += 1;
    }
    if (dateFilter !== "any") {
      count += 1;
    }
    return count;
  }, [dateFilter, durationFilter, styleFilter]);

  const filteredWorks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return works.filter((work) => {
      if (normalizedQuery) {
        const haystack = `${work.title} ${work.prompt ?? ""}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) {
          return false;
        }
      }
      if (styleFilter !== "all") {
        if (styleFilter === "unknown") {
          if (work.style) {
            return false;
          }
        } else if (work.style !== styleFilter) {
          return false;
        }
      }
      if (!matchesDuration(work.duration, durationFilter)) {
        return false;
      }
      if (dateFilter === "has" && !work.createdAt) {
        return false;
      }
      if (dateFilter === "none" && work.createdAt) {
        return false;
      }
      return true;
    });
  }, [works, query, styleFilter, durationFilter, dateFilter]);

  return (
    <div className="page library-page">
      <header className="page-header library-header">
        <div className="library-title-block">
          <h1 className="page-title">Library</h1>
          <p className="page-subtitle">Recent works stored locally.</p>
        </div>
        <div className="library-count">{filteredWorks.length} results</div>
      </header>
      <LibraryCommandBar
        query={query}
        filterCount={filterCount}
        chips={activeFilterChips}
        isFiltersOpen={filtersOpen}
        onQueryChange={setQuery}
        onOpenFilters={() => setFiltersOpen(true)}
      />
      {filteredWorks.length === 0 ? (
        <div className="library-empty">
          <div className="library-empty-title">No matches yet</div>
          <div className="library-empty-subtitle">Adjust filters or start a new creation.</div>
          <a className="library-empty-action" href="/">
            Create new
          </a>
        </div>
      ) : (
        <div className="library-grid">
          {filteredWorks.map((work) => (
            <WorkCard
              key={work.jobId}
              jobId={work.jobId}
              title={work.title}
              thumbnailUri={work.thumbnailUri}
              style={work.style}
              duration={work.duration}
              status={work.status}
              createdAt={work.createdAt}
              loading={work.loading}
              error={work.error}
              onRemove={removeWork}
            />
          ))}
        </div>
      )}
      <LibraryFilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        style={styleFilter}
        duration={durationFilter}
        date={dateFilter}
        styleOptions={styleOptions}
        durationOptions={durationOptions}
        dateOptions={dateOptions}
        onStyleChange={setStyleFilter}
        onDurationChange={setDurationFilter}
        onDateChange={setDateFilter}
        onClear={() => {
          setStyleFilter("all");
          setDurationFilter("any");
          setDateFilter("any");
        }}
      />
    </div>
  );
};
