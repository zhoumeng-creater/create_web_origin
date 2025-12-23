import type { ChangeEvent } from "react";

type PreviewControlsProps = {
  playing: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  muted: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
  onSpeedChange: (speed: number) => void;
  onToggleMute: () => void;
};

const speedOptions = [0.5, 1, 1.5, 2];

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const formatTime = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "--:--";
  }
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const PreviewControls = ({
  playing,
  currentTime,
  duration,
  speed,
  muted,
  onTogglePlay,
  onSeek,
  onSeekStart,
  onSeekEnd,
  onSpeedChange,
  onToggleMute,
}: PreviewControlsProps) => {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const clampedTime = clamp(currentTime, 0, safeDuration || 0);

  const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(event.target.value);
    if (Number.isFinite(nextTime)) {
      onSeek(nextTime);
    }
  };

  const handleSpeedChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSpeed = Number(event.target.value);
    if (Number.isFinite(nextSpeed)) {
      onSpeedChange(nextSpeed);
    }
  };

  return (
    <div className="three-preview-controls">
      <button
        type="button"
        className="three-preview-button"
        onClick={onTogglePlay}
        aria-pressed={playing}
      >
        {playing ? "暂停" : "播放"}
      </button>
      <div className="three-preview-progress">
        <input
          type="range"
          min={0}
          max={safeDuration}
          step={0.01}
          value={clampedTime}
          onChange={handleSeek}
          onPointerDown={onSeekStart}
          onPointerUp={onSeekEnd}
          onPointerCancel={onSeekEnd}
          aria-label="时间轴"
          className="three-preview-range"
        />
        <div className="three-preview-time">
          {formatTime(clampedTime)} / {formatTime(safeDuration)}
        </div>
      </div>
      <label className="three-preview-speed">
        <span>速度</span>
        <select value={speed} onChange={handleSpeedChange}>
          {speedOptions.map((value) => (
            <option key={value} value={value}>
              {value}x
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="three-preview-button"
        onClick={onToggleMute}
        aria-pressed={muted}
      >
        {muted ? "取消静音" : "静音"}
      </button>
    </div>
  );
};
