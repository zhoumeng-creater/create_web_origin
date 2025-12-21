import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";

import { getAssetUrl } from "../../lib/api";
import type { PreviewConfig } from "../../types/previewConfig";
import { PreviewControls } from "./PreviewControls";
import { PreviewScene } from "./PreviewScene";
import "./preview.css";

type ThreePreviewPlayerProps = {
  config: PreviewConfig;
  className?: string;
  style?: React.CSSProperties;
};

type SceneErrorBoundaryProps = {
  onError: (error: Error) => void;
  resetKey: string;
  children: React.ReactNode;
};

type SceneErrorBoundaryState = {
  hasError: boolean;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

class SceneErrorBoundary extends React.Component<
  SceneErrorBoundaryProps,
  SceneErrorBoundaryState
> {
  state: SceneErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  componentDidUpdate(prevProps: SceneErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

export const ThreePreviewPlayer = ({
  config,
  className,
  style,
}: ThreePreviewPlayerProps) => {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(() => config.timeline?.duration_s ?? 12);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [seekTime, setSeekTime] = useState<number | null>(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const resetKey = useMemo(
    () =>
      JSON.stringify({
        panorama: config.scene?.panorama_uri ?? "",
        bvh: config.motion?.bvh_uri ?? "",
        model: config.character?.model_uri ?? "",
      }),
    [config]
  );

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setSeekTime(0);
    setError(null);
    setLoading(true);
    if (config.timeline?.duration_s && Number.isFinite(config.timeline.duration_s)) {
      setDuration(config.timeline.duration_s);
    } else {
      setDuration(12);
    }
  }, [config]);

  const syncAudio = useCallback((time: number, force = false) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const cappedTime = Math.min(
      time,
      Number.isFinite(audio.duration) ? audio.duration : time
    );
    if (force || Math.abs(audio.currentTime - cappedTime) > 0.2) {
      audio.currentTime = cappedTime;
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.muted = muted;
  }, [muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playing) {
      syncAudio(currentTime, true);
      const result = audio.play();
      if (result) {
        result.catch(() => undefined);
      }
    } else {
      audio.pause();
    }
  }, [playing, currentTime, syncAudio]);

  const handleTimeUpdate = useCallback(
    (time: number) => {
      if (isScrubbing) {
        return;
      }
      setCurrentTime(time);
      syncAudio(time);
    },
    [isScrubbing, syncAudio]
  );

  const handleSeek = useCallback(
    (time: number) => {
      const nextTime = clamp(time, 0, duration || 0);
      setCurrentTime(nextTime);
      setSeekTime(nextTime);
      syncAudio(nextTime, true);
    },
    [duration, syncAudio]
  );

  const handleClipDuration = useCallback(
    (clipDuration: number) => {
      if (config.timeline?.duration_s) {
        return;
      }
      if (Number.isFinite(clipDuration) && clipDuration > 0) {
        setDuration(clipDuration);
      }
    },
    [config.timeline?.duration_s]
  );

  const handleReady = useCallback(() => {
    setLoading(false);
  }, []);

  const handleError = useCallback((err: Error) => {
    setError(err.message || "Failed to load preview.");
    setLoading(false);
  }, []);

  const audioSrc = config.music?.wav_uri ? getAssetUrl(config.music.wav_uri) : undefined;

  return (
    <div className={`three-preview-player ${className ?? ""}`.trim()} style={style}>
      <div className="three-preview-canvas">
        <SceneErrorBoundary onError={handleError} resetKey={resetKey}>
          <Canvas
            camera={{ position: [0, 1.6, 3.2], fov: 45 }}
            dpr={[1, 2]}
            gl={{ antialias: true }}
          >
            <Suspense fallback={null}>
              <PreviewScene
                config={config}
                playing={playing}
                speed={speed}
                seekTime={seekTime}
                timelineDuration={duration}
                isScrubbing={isScrubbing}
                onTimeUpdate={handleTimeUpdate}
                onClipDuration={handleClipDuration}
                onReady={handleReady}
              />
            </Suspense>
          </Canvas>
        </SceneErrorBoundary>
        {loading && !error ? (
          <div className="three-preview-overlay">Loading preview...</div>
        ) : null}
        {error ? (
          <div className="three-preview-overlay error">
            <div>
              <div className="three-preview-overlay-title">Preview error</div>
              <div className="three-preview-overlay-message">{error}</div>
            </div>
          </div>
        ) : null}
      </div>
      <PreviewControls
        playing={playing}
        currentTime={currentTime}
        duration={duration}
        speed={speed}
        muted={muted}
        onTogglePlay={() => setPlaying((value) => !value)}
        onSeek={handleSeek}
        onSeekStart={() => setIsScrubbing(true)}
        onSeekEnd={() => setIsScrubbing(false)}
        onSpeedChange={setSpeed}
        onToggleMute={() => setMuted((value) => !value)}
      />
      {audioSrc ? (
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="auto"
          loop
          onLoadedMetadata={() => syncAudio(currentTime, true)}
        />
      ) : null}
    </div>
  );
};
