import { useEffect, useMemo, useRef, useState } from "react";

import { getAssetUrl } from "../../lib/api";

type WorkCardProps = {
  jobId: string;
  title: string;
  thumbnailUri?: string;
  style?: string;
  duration?: number;
  status?: string;
  createdAt?: string;
  loading?: boolean;
  error?: string;
  onRemove: (jobId: string) => void;
};

const formatDuration = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}s`;
};

const formatDate = (value?: string) => {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
};

export const WorkCard = ({
  jobId,
  title,
  thumbnailUri,
  style,
  duration,
  status,
  createdAt,
  loading,
  error,
  onRemove,
}: WorkCardProps) => {
  const [imageFailed, setImageFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const thumbnailUrl = useMemo(
    () => (thumbnailUri ? getAssetUrl(thumbnailUri) : undefined),
    [thumbnailUri]
  );
  const displayStyle = style || "default";
  const displayDuration = formatDuration(duration);
  const displayDate = formatDate(createdAt);
  const normalizedStatus = (status ?? "").toLowerCase();
  const rawStatus = error ? "error" : loading ? "loading" : normalizedStatus || "unknown";
  const displayStatus = rawStatus
    .replace(/_/g, " ")
    .replace(/^\w/, (match) => match.toUpperCase());
  const hasStatus = Boolean(error || loading || normalizedStatus);
  const statusTone = error
    ? "error"
    : loading
      ? "loading"
      : ["done", "completed", "success"].includes(normalizedStatus)
        ? "ready"
        : normalizedStatus
          ? "idle"
          : "unknown";

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuOpen]);

  return (
    <article className="work-card">
      <a className="work-card-link" href={`/works/${jobId}`}>
        <div className="work-card-media">
          {thumbnailUrl && !imageFailed ? (
            <img
              src={thumbnailUrl}
              alt={title}
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="work-card-placeholder">
              <div className="work-card-placeholder-inner">No preview</div>
            </div>
          )}
        </div>
        <div className="work-card-body">
          <div className="work-card-title">{title}</div>
          <div className="work-card-meta">
            <span className="work-card-tag">{displayStyle}</span>
            <span className="work-card-tag">{displayDuration}</span>
          </div>
          <div className="work-card-meta-secondary">
            {hasStatus ? <span className={`work-card-status ${statusTone}`}>{displayStatus}</span> : null}
            {displayDate ? <span className="work-card-date">{displayDate}</span> : null}
          </div>
        </div>
      </a>
      <div
        className="work-card-actions"
        ref={menuRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setMenuOpen(false);
          }
        }}
      >
        <button
          type="button"
          className="work-card-action-button"
          aria-label="More actions"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen((prev) => !prev);
          }}
        >
          ...
        </button>
        <div className={`work-card-menu${menuOpen ? " open" : ""}`} role="menu">
          <button
            type="button"
            className="work-card-menu-item"
            role="menuitem"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen(false);
              onRemove(jobId);
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </article>
  );
};
