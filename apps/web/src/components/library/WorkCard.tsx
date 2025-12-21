import { useMemo, useState } from "react";

import { getAssetUrl } from "../../lib/api";

type WorkCardProps = {
  jobId: string;
  title: string;
  prompt?: string;
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
  if (!Number.isFinite(value)) {
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
  prompt,
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
  const thumbnailUrl = useMemo(
    () => (thumbnailUri ? getAssetUrl(thumbnailUri) : undefined),
    [thumbnailUri]
  );
  const displayStatus = error ? "error" : loading ? "loading" : status ?? "unknown";
  const displayStyle = style || "default";
  const displayDuration = formatDuration(duration);
  const displayDate = formatDate(createdAt);

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
          {prompt ? <div className="work-card-prompt">{prompt}</div> : null}
          <div className="work-card-tags">
            <span>{`style: ${displayStyle}`}</span>
            <span>{`duration: ${displayDuration}`}</span>
            <span>{`status: ${displayStatus}`}</span>
          </div>
          {displayDate ? <div className="work-card-date">{displayDate}</div> : null}
        </div>
      </a>
      <button
        type="button"
        className="work-card-remove"
        onClick={() => onRemove(jobId)}
      >
        Remove
      </button>
    </article>
  );
};
