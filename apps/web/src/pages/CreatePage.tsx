import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PreviewPanel } from "../components/preview/PreviewPanel";
import { SelectMenu, type SelectOption } from "../components/ui/SelectMenu";
import { useJobRunner } from "../hooks/useJobRunner";
import { fetchManifest, fetchPreviewConfig, getAssetUrl } from "../lib/api";
import {
  getActiveSessionId,
  getSessionDetail,
  onSessionsUpdate,
  saveRecentWork,
  saveSessionDetail,
  setActiveSessionId,
  updateSessionIndex,
  type SessionDetail,
  type SessionStatus,
} from "../lib/storage";
import type { Manifest } from "../types/manifest";
import type { PreviewConfig } from "../types/previewConfig";
import "./pages.css";

type MessageRole = "user" | "system" | "tool" | "result";
type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
};

type InspectorStage = "choosing_options" | "running" | "complete";
type InspectorTab = "preview" | "assets" | "export";

const INSPECTOR_STAGE_LABELS: Record<InspectorStage, string> = {
  choosing_options: "参数",
  running: "生成中",
  complete: "交付",
};

const STYLE_OPTIONS = [
  {
    id: "cinematic",
    title: "电影感",
    description: "高对比光影与大片构图。",
  },
  {
    id: "anime",
    title: "动漫",
    description: "线条化渲染与高饱和色彩。",
  },
  {
    id: "low_poly",
    title: "低多边形",
    description: "块面几何与简化质感。",
  },
  {
    id: "realistic",
    title: "写实",
    description: "真实光照与细节层次。",
  },
];

const MOOD_OPTIONS = [
  { id: "epic", label: "史诗" },
  { id: "calm", label: "平静" },
  { id: "horror", label: "恐怖" },
];

const MODEL_OPTIONS: SelectOption[] = [
  { value: "atlas_3_preview", label: "Atlas-3 预览" },
  { value: "atlas_3_pro", label: "Atlas-3 高级" },
];

const RESOLUTION_PRESETS = [
  { id: "panorama_2k", label: "全景 2K (2048×1024)", value: [2048, 1024] as [number, number] },
  { id: "1080p", label: "1080p (1920×1080)", value: [1920, 1080] as [number, number] },
  { id: "720p", label: "720p (1280×720)", value: [1280, 720] as [number, number] },
];

const RESOLUTION_SELECT_OPTIONS: SelectOption[] = RESOLUTION_PRESETS.map((preset) => ({
  value: preset.id,
  label: preset.label,
}));

const EXPORT_PRESETS = [
  { value: "mp4_720p", label: "720p（1280×720）" },
  { value: "mp4_1080p", label: "1080p（1920×1080）" },
  { value: "mp4_4k", label: "4K（3840×2160）" },
];

const EXPORT_SELECT_OPTIONS: SelectOption[] = EXPORT_PRESETS.map((preset) => ({
  value: preset.value,
  label: preset.label,
}));

const STAGE_LABELS: Record<string, string> = {
  QUEUED: "排队中",
  PLANNING: "规划",
  RUNNING_MOTION: "动作",
  RUNNING_SCENE: "场景",
  RUNNING_MUSIC: "音乐",
  COMPOSING_PREVIEW: "预览合成",
  EXPORTING_VIDEO: "导出",
  DONE: "完成",
  FAILED: "失败",
  CANCELED: "已取消",
  ERROR: "错误",
};

const resolveStageLabel = (stage?: string, status?: string) => {
  const key = (stage ?? status ?? "").toUpperCase();
  return STAGE_LABELS[key] ?? stage ?? status ?? "准备中";
};

const INSPECTOR_STEPS = [
  { id: "options", label: "参数" },
  { id: "running", label: "生成" },
  { id: "review", label: "交付" },
];

const INSPECTOR_TABS = [
  { id: "preview", label: "预览" },
  { id: "assets", label: "素材" },
  { id: "export", label: "导出" },
] as const;

const DEFAULT_DURATION = 14;
const DEFAULT_ADVANCED_SETTINGS = {
  model: MODEL_OPTIONS[0].value,
  seed: "",
  resolution: RESOLUTION_PRESETS[0].id,
};
const DEFAULT_EXPORT_PRESET = EXPORT_PRESETS[1]?.value ?? EXPORT_PRESETS[0].value;
const DEFAULT_INSPECTOR_STAGE: InspectorStage = "choosing_options";
const DEFAULT_ACTIVE_TAB: InspectorTab = "preview";

const TEMPLATE_SNIPPETS = [
  { id: "action", label: "动作", template: "动作：" },
  { id: "shot", label: "镜头", template: "镜头：" },
  { id: "mood", label: "氛围", template: "氛围：" },
  { id: "duration", label: "时长", template: "时长：" },
];


const createMessageId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const createSessionId = () =>
  `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const mapJobStatusToSessionStatus = (
  status?: string,
  error?: string | null
): SessionStatus => {
  if (error) {
    return "error";
  }
  const normalized = status?.toUpperCase() ?? "";
  if (!normalized) {
    return "draft";
  }
  if (normalized === "QUEUED") {
    return "queued";
  }
  if (normalized === "DONE" || normalized === "COMPLETED") {
    return "done";
  }
  if (normalized === "FAILED" || normalized === "ERROR") {
    return "error";
  }
  return "running";
};

const buildDefaultSessionDetail = (sessionId: string, createdAt: string): SessionDetail => ({
  id: sessionId,
  createdAt,
  updatedAt: createdAt,
  status: "draft",
  messages: INITIAL_MESSAGES,
  draft: "",
  options: {
    style: STYLE_OPTIONS[0].id,
    mood: MOOD_OPTIONS[0].id,
    duration: DEFAULT_DURATION,
    advancedSettings: DEFAULT_ADVANCED_SETTINGS,
    exportPreset: DEFAULT_EXPORT_PRESET,
  },
  ui: {
    inspectorStage: DEFAULT_INSPECTOR_STAGE,
    activeTab: DEFAULT_ACTIVE_TAB,
  },
});

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "system-1",
    role: "system",
    content:
      "我是你的创作助理，会把你的描述拆解成镜头、情绪与节奏。右侧面板已准备好记录风格与参数。发送一句话描述，开始构建场景。",
  },
];

export const CreatePage = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [inspectorStage, setInspectorStage] = useState<InspectorStage>(DEFAULT_INSPECTOR_STAGE);
  const [selectedStyle, setSelectedStyle] = useState(STYLE_OPTIONS[0].id);
  const [selectedMood, setSelectedMood] = useState(MOOD_OPTIONS[0].id);
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedSettings, setAdvancedSettings] = useState(DEFAULT_ADVANCED_SETTINGS);
  const [exportPreset, setExportPreset] = useState(DEFAULT_EXPORT_PRESET);
  const [activeTab, setActiveTab] = useState<InspectorTab>(DEFAULT_ACTIVE_TAB);
  const [toolMessageId, setToolMessageId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [previewConfig, setPreviewConfig] = useState<PreviewConfig | null>(null);
  const [previewConfigMissing, setPreviewConfigMissing] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionCreatedAt, setSessionCreatedAt] = useState<string>("");
  const assetsJobRef = useRef<string | null>(null);
  const chatThreadRef = useRef<HTMLUListElement | null>(null);
  const chatThreadWrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatInputBoxRef = useRef<HTMLDivElement | null>(null);
  const advancedToggleRef = useRef<HTMLButtonElement | null>(null);
  const advancedPanelRef = useRef<HTMLDivElement | null>(null);
  const recentSaveRef = useRef<string>("");
  const sessionInitRef = useRef(false);
  const lastSessionStatusRef = useRef<string | null>(null);
  const sessionJobIdRef = useRef<string | null>(null);
  const lastJobIdRef = useRef<string | null>(null);
  const sessionSwitchRef = useRef(false);

  const latestPrompt = useMemo(() => {
    const match = [...messages].reverse().find((message) => message.role === "user");
    return match?.content ?? "";
  }, [messages]);
  const hasPrompt = latestPrompt.trim().length > 0;
  const canSend = draft.trim().length > 0;
  const resolutionPreset = useMemo(
    () => RESOLUTION_PRESETS.find((preset) => preset.id === advancedSettings.resolution),
    [advancedSettings.resolution]
  );
  const seedValue = useMemo(() => {
    const trimmed = advancedSettings.seed.trim();
    if (!trimmed) {
      return undefined;
    }
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return undefined;
    }
    return Math.max(0, Math.floor(numeric));
  }, [advancedSettings.seed]);
  const jobOptions = useMemo(
    () => {
      const advanced: {
        model?: string;
        seed?: number;
        resolution?: [number, number];
      } = {
        model: advancedSettings.model,
      };
      if (seedValue !== undefined) {
        advanced.seed = seedValue;
      }
      if (resolutionPreset) {
        advanced.resolution = resolutionPreset.value;
      }
      return {
        style: selectedStyle,
        mood: selectedMood,
        duration_s: duration,
        export_video: true,
        export_preset: exportPreset,
        advanced,
      };
    },
    [advancedSettings.model, duration, exportPreset, resolutionPreset, seedValue, selectedMood, selectedStyle]
  );
  const {
    jobId,
    jobStatus,
    error: jobError,
    isStarting,
    start: startJob,
    subscribeExistingJob,
    reset: resetJobRunner,
  } = useJobRunner(latestPrompt, jobOptions);

  const insertTemplate = useCallback(
    (template: string) => {
      const textarea = inputRef.current;
      if (!textarea) {
        setDraft((prev) => (prev ? `${prev}\n${template}` : template));
        return;
      }
      const start = textarea.selectionStart ?? draft.length;
      const end = textarea.selectionEnd ?? draft.length;
      const before = draft.slice(0, start);
      const after = draft.slice(end);
      const needsBreak = before.length > 0 && !before.endsWith("\n");
      const insertion = `${needsBreak ? "\n" : ""}${template}`;
      const next = `${before}${insertion}${after}`;
      setDraft(next);
      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + insertion.length;
        textarea.setSelectionRange(cursor, cursor);
      });
    },
    [draft]
  );

  const adjustSeed = useCallback((delta: number) => {
    setAdvancedSettings((prev) => {
      const current = Number(prev.seed);
      const base = Number.isFinite(current) ? current : 0;
      const next = Math.max(0, base + delta);
      return { ...prev, seed: String(next) };
    });
  }, []);

  const buildSessionDetail = useCallback(
    (overrides: Partial<SessionDetail> = {}): SessionDetail => {
      const now = new Date().toISOString();
      const resolvedId = overrides.id ?? sessionId ?? createSessionId();
      const createdAt = overrides.createdAt ?? (sessionCreatedAt || now);
      const resolvedLastPrompt =
        overrides.lastPrompt ?? (latestPrompt.trim() ? latestPrompt.trim() : undefined);
      return {
        id: resolvedId,
        createdAt,
        updatedAt: overrides.updatedAt ?? now,
        status: overrides.status ?? mapJobStatusToSessionStatus(jobStatus?.status, jobError),
        jobId: overrides.jobId ?? jobId ?? undefined,
        lastPrompt: resolvedLastPrompt,
        messages: overrides.messages ?? messages,
        draft: overrides.draft ?? draft,
        options: overrides.options ?? {
          style: selectedStyle,
          mood: selectedMood,
          duration,
          advancedSettings,
          exportPreset,
        },
        ui: overrides.ui ?? {
          inspectorStage,
          activeTab,
        },
      };
    },
    [
      activeTab,
      advancedSettings,
      draft,
      duration,
      exportPreset,
      inspectorStage,
      jobError,
      jobId,
      jobStatus?.status,
      latestPrompt,
      messages,
      selectedMood,
      selectedStyle,
      sessionCreatedAt,
      sessionId,
    ]
  );

  const resetJobSubscription = useCallback(() => {
    resetJobRunner();
    sessionJobIdRef.current = null;
    lastSessionStatusRef.current = null;
    lastJobIdRef.current = null;
  }, [resetJobRunner]);

  const applySessionDetail = useCallback((detail: SessionDetail) => {
    setSessionId(detail.id);
    setSessionCreatedAt(detail.createdAt);
    setMessages(detail.messages.length > 0 ? detail.messages : INITIAL_MESSAGES);
    setDraft(detail.draft);
    setInspectorStage(detail.ui.inspectorStage);
    setActiveTab(detail.ui.activeTab);
    setSelectedStyle(detail.options.style);
    setSelectedMood(detail.options.mood);
    setDuration(detail.options.duration);
    setAdvancedSettings(detail.options.advancedSettings);
    setExportPreset(detail.options.exportPreset);
    setPendingPrompt(null);
    setToolMessageId(null);
    setManifest(null);
    setPreviewConfig(null);
    setPreviewConfigMissing(false);
    setAssetError(null);
    setIsLoadingAssets(false);
    assetsJobRef.current = null;
  }, []);

  const loadSessionById = useCallback(
    (targetId: string | null) => {
      sessionSwitchRef.current = true;
      try {
        if (sessionId && targetId !== sessionId) {
          saveSessionDetail(buildSessionDetail());
        }
        resetJobSubscription();
        if (targetId) {
          const detail = getSessionDetail(targetId);
          if (detail) {
            applySessionDetail(detail);
            if (detail.jobId) {
              subscribeExistingJob(detail.jobId);
            }
            return;
          }
        }
        const newId = createSessionId();
        const now = new Date().toISOString();
        const detail = buildDefaultSessionDetail(newId, now);
        setActiveSessionId(newId);
        saveSessionDetail(detail);
        applySessionDetail(detail);
      } finally {
        sessionSwitchRef.current = false;
      }
    },
    [applySessionDetail, buildSessionDetail, resetJobSubscription, sessionId, subscribeExistingJob]
  );

  useEffect(() => {
    if (sessionInitRef.current) {
      return;
    }
    sessionInitRef.current = true;
    loadSessionById(getActiveSessionId());
  }, [loadSessionById]);

  useEffect(() => {
    if (!advancedOpen) {
      return;
    }
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        (advancedPanelRef.current && advancedPanelRef.current.contains(target)) ||
        (advancedToggleRef.current && advancedToggleRef.current.contains(target))
      ) {
        return;
      }
      setAdvancedOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
    };
  }, [advancedOpen]);

  useEffect(() => {
    const textarea = inputRef.current;
    const container = chatInputBoxRef.current;
    if (!textarea || !container) {
      return;
    }
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const { scrollTop, scrollHeight, clientHeight } = textarea;
      const hasOverflow = scrollHeight > clientHeight + 1;
      const trackHeight = clientHeight;
      const thumbHeight = hasOverflow
        ? Math.max(24, (clientHeight / scrollHeight) * trackHeight)
        : 0;
      const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
      const maxScrollTop = Math.max(1, scrollHeight - clientHeight);
      const thumbTop = hasOverflow ? (scrollTop / maxScrollTop) * maxThumbTop : 0;
      container.style.setProperty("--input-scroll-visible", hasOverflow ? "1" : "0");
      container.style.setProperty("--input-scroll-thumb-height", `${thumbHeight}px`);
      container.style.setProperty("--input-scroll-thumb-top", `${thumbTop}px`);
    };
    const schedule = () => {
      if (frame !== null) {
        return;
      }
      frame = requestAnimationFrame(update);
    };
    update();
    textarea.addEventListener("scroll", schedule);
    textarea.addEventListener("input", schedule);
    window.addEventListener("resize", schedule);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resizeObserver?.observe(textarea);
    return () => {
      textarea.removeEventListener("scroll", schedule);
      textarea.removeEventListener("input", schedule);
      window.removeEventListener("resize", schedule);
      resizeObserver?.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [draft]);

  useEffect(() => {
    const handler = () => {
      if (sessionSwitchRef.current) {
        return;
      }
      const activeId = getActiveSessionId();
      if (activeId === sessionId) {
        return;
      }
      loadSessionById(activeId);
    };
    return onSessionsUpdate(handler);
  }, [loadSessionById, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    const timer = globalThis.setTimeout(() => {
      saveSessionDetail(buildSessionDetail());
    }, 400);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [buildSessionDetail, sessionId]);

  const activeStepIndex =
    inspectorStage === "complete" ? 2 : inspectorStage === "running" ? 1 : 0;

  const progressValue =
    typeof jobStatus?.progress === "number"
      ? Math.max(0, Math.min(100, Math.round(jobStatus.progress)))
      : 0;
  const progressLabel = typeof jobStatus?.progress === "number" ? `${progressValue}%` : "--";
  const progressStage = resolveStageLabel(jobStatus?.stage, jobStatus?.status);
  const logLines =
    jobStatus?.logs_tail && jobStatus.logs_tail.length > 0
      ? jobStatus.logs_tail.slice(-3)
      : jobStatus?.message
        ? [jobStatus.message]
        : ["等待日志输出..."];
  const queuePosition = jobStatus?.queue_position;
  const normalizedJobStatus = jobStatus?.status?.toUpperCase() ?? "";
  const queueLabel =
    queuePosition !== undefined
      ? `#${queuePosition}`
      : normalizedJobStatus === "QUEUED"
        ? "排队中"
        : "--";
  const isJobDone = normalizedJobStatus === "DONE" || normalizedJobStatus === "COMPLETED";
  const isJobActive =
    !!jobStatus && !["DONE", "COMPLETED", "FAILED", "ERROR"].includes(normalizedJobStatus);

  const assetItems = useMemo(() => {
    const items: Array<{ id: string; label: string; href: string; kind: string }> = [];
    const seen = new Set<string>();
    const addItem = (label: string, uri: string | undefined, kind: string) => {
      if (!uri) {
        return;
      }
      const href = getAssetUrl(uri);
      if (seen.has(href)) {
        return;
      }
      seen.add(href);
      items.push({ id: `${kind}-${items.length}`, label, href, kind });
    };

    const outputs = manifest?.outputs;
    addItem("场景全景 PNG", outputs?.scene?.panorama?.uri, "png");
    addItem("动作 BVH", outputs?.motion?.bvh?.uri, "bvh");
    addItem("配乐 WAV", outputs?.music?.wav?.uri, "wav");
    addItem("导出 MP4", outputs?.export?.mp4?.uri, "mp4");
    addItem("导出 ZIP", outputs?.export?.zip?.uri ?? undefined, "zip");

    if (jobStatus) {
      addItem("预览 MP4", jobStatus.preview_url, "mp4");
      if (Array.isArray(jobStatus.mp4_list)) {
        jobStatus.mp4_list.forEach((uri) => addItem("预览 MP4", uri, "mp4"));
      }
      addItem("动作 BVH", jobStatus.bvh_download_url ?? jobStatus.download_url, "bvh");
      addItem("配乐 WAV", jobStatus.audio_url, "wav");
      addItem("导出 ZIP", jobStatus.zip_url, "zip");
    }

    return items;
  }, [jobStatus, manifest]);

  const previewLinks = useMemo(
    () => assetItems.filter((item) => ["mp4", "wav", "bvh"].includes(item.kind)),
    [assetItems]
  );
  const assetDownloads = useMemo(
    () => assetItems.filter((item) => ["png", "bvh", "wav"].includes(item.kind)),
    [assetItems]
  );
  const audioPreviewUrl = jobStatus?.audio_url ?? previewConfig?.music?.wav_uri;
  const audioPreviewSrc = audioPreviewUrl ? getAssetUrl(audioPreviewUrl) : "";
  const exportMp4 =
    assetItems.find((item) => item.label.includes("导出 MP4")) ??
    assetItems.find((item) => item.kind === "mp4");

  const toolMessageContent = useMemo(() => {
    if (!toolMessageId) {
      return "";
    }
    if (jobError) {
      return `生成失败：${jobError}`;
    }
    if (!jobId) {
      return "正在创建任务...";
    }
    if (!jobStatus) {
      return `任务已创建（${jobId}），等待事件流连接...`;
    }
    const normalizedStatus = jobStatus.status?.toUpperCase();
    if (normalizedStatus === "DONE" || normalizedStatus === "COMPLETED") {
      return "生成完成，正在准备预览。";
    }
    if (normalizedStatus === "ERROR" || normalizedStatus === "FAILED") {
      return `生成失败：${jobStatus.message ?? "未知错误"}`;
    }
    const toolLogLines =
      jobStatus.logs_tail && jobStatus.logs_tail.length > 0
        ? jobStatus.logs_tail.slice(-3)
        : jobStatus.message
          ? [jobStatus.message]
          : [];
    const logSummary = toolLogLines.length > 0 ? `\n${toolLogLines.join("\n")}` : "";
    return `生成中 ${progressLabel} · ${progressStage}${logSummary}`;
  }, [jobError, jobId, jobStatus, progressLabel, progressStage, toolMessageId]);

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    const now = new Date().toISOString();
    const nextMessages: ChatMessage[] = [
      ...messages,
      { id: createMessageId(), role: "user", content: trimmed },
      { id: createMessageId(), role: "system", content: "正在规划..." },
    ];
    setMessages(nextMessages);
    if (sessionId) {
      saveSessionDetail(
        buildSessionDetail({
          messages: nextMessages,
          draft: "",
          lastPrompt: trimmed,
          updatedAt: now,
          status: "draft",
          ui: {
            inspectorStage: DEFAULT_INSPECTOR_STAGE,
            activeTab,
          },
        })
      );
    }
    setDraft("");
    setToolMessageId(null);
    setInspectorStage(DEFAULT_INSPECTOR_STAGE);
    setPendingPrompt(trimmed);
  };

  useEffect(() => {
    if (!jobId || jobId === lastJobIdRef.current) {
      return;
    }
    if (!sessionId) {
      return;
    }
    lastJobIdRef.current = jobId;
    const now = new Date().toISOString();
    const status = mapJobStatusToSessionStatus(jobStatus?.status, jobError);
    const existing = getSessionDetail(sessionId);
    const detail = existing
      ? { ...existing, jobId, status, updatedAt: now }
      : buildSessionDetail({ jobId, status, updatedAt: now });
    saveSessionDetail(detail);
    sessionJobIdRef.current = jobId;
  }, [jobId, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    if (!jobId || sessionJobIdRef.current !== jobId) {
      return;
    }
    const statusKey = jobError ? "ERROR" : jobStatus?.status;
    if (!statusKey) {
      return;
    }
    if (lastSessionStatusRef.current === statusKey) {
      return;
    }
    lastSessionStatusRef.current = statusKey;
    updateSessionIndex(sessionId, {
      status: mapJobStatusToSessionStatus(statusKey, jobError),
      updatedAt: new Date().toISOString(),
    });
  }, [jobError, jobStatus?.status, sessionId]);

  useEffect(() => {
    if (!toolMessageId || !toolMessageContent) {
      return;
    }
    setMessages((prev) =>
      prev.map((message) =>
        message.id === toolMessageId ? { ...message, content: toolMessageContent } : message
      )
    );
  }, [toolMessageContent, toolMessageId]);

  useEffect(() => {
    if (!jobStatus) {
      return;
    }
    const normalizedStatus = jobStatus.status?.toUpperCase();
    if (normalizedStatus === "DONE" || normalizedStatus === "COMPLETED") {
      setInspectorStage("complete");
      setActiveTab("preview");
    }
  }, [jobStatus]);

  useEffect(() => {
    if (!jobId || !isJobDone) {
      return;
    }
    if (assetsJobRef.current === jobId) {
      return;
    }
    assetsJobRef.current = jobId;
    setManifest(null);
    setPreviewConfig(null);
    setPreviewConfigMissing(false);
    setAssetError(null);
    setIsLoadingAssets(true);

    let cancelled = false;
    const loadAssets = async () => {
      const loadError = (error: unknown) =>
        error instanceof Error ? error.message : "资源加载失败";

      try {
        const data = await fetchManifest(jobId);
        if (!cancelled) {
          setManifest(data);
        }
      } catch (error) {
        if (!cancelled) {
          const status = (error as { status?: number }).status;
          if (status && status !== 404) {
            setAssetError(loadError(error));
          }
        }
      }

      try {
        const config = await fetchPreviewConfig(jobId);
        if (!cancelled) {
          setPreviewConfig(config);
        }
      } catch (error) {
        if (!cancelled) {
          const status = (error as { status?: number }).status;
          if (status === 404) {
            setPreviewConfigMissing(true);
          } else {
            setAssetError(loadError(error));
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAssets(false);
        }
      }
    };

    loadAssets();
    return () => {
      cancelled = true;
    };
  }, [isJobDone, jobId]);

  const handleStartGeneration = useCallback(async () => {
    if (!hasPrompt || isStarting || isJobActive) {
      return;
    }
    const toolId = `tool-${createMessageId()}`;
    setMessages((prev) => [
      ...prev,
      { id: toolId, role: "tool", content: "正在创建任务..." },
    ]);
    setToolMessageId(toolId);
    setPendingPrompt(null);
    setInspectorStage("running");
    setManifest(null);
    setPreviewConfig(null);
    setPreviewConfigMissing(false);
    setAssetError(null);
    setIsLoadingAssets(false);
    assetsJobRef.current = null;
    try {
      await startJob();
    } catch (error) {
      const message = error instanceof Error ? error.message : "任务创建失败";
      setMessages((prev) =>
        prev.map((item) =>
          item.id === toolId ? { ...item, content: `创建失败：${message}` } : item
        )
      );
      setInspectorStage(DEFAULT_INSPECTOR_STAGE);
    }
  }, [hasPrompt, isJobActive, isStarting, startJob]);

  useEffect(() => {
    if (!pendingPrompt) {
      return;
    }
    if (latestPrompt.trim() !== pendingPrompt.trim()) {
      return;
    }
    if (isStarting || isJobActive) {
      return;
    }
    handleStartGeneration();
    setPendingPrompt(null);
  }, [handleStartGeneration, isJobActive, isStarting, latestPrompt, pendingPrompt]);

  useEffect(() => {
    const thread = chatThreadRef.current;
    if (!thread) {
      return;
    }
    requestAnimationFrame(() => {
      thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
    });
  }, [messages]);

  useEffect(() => {
    const thread = chatThreadRef.current;
    const wrapper = chatThreadWrapRef.current;
    if (!thread || !wrapper) {
      return;
    }
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const { scrollTop, scrollHeight, clientHeight } = thread;
      const hasOverflow = scrollHeight > clientHeight + 1;
      const trackHeight = clientHeight;
      const thumbHeight = hasOverflow
        ? Math.max(32, (clientHeight / scrollHeight) * trackHeight)
        : 0;
      const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
      const maxScrollTop = Math.max(1, scrollHeight - clientHeight);
      const thumbTop = hasOverflow ? (scrollTop / maxScrollTop) * maxThumbTop : 0;
      wrapper.style.setProperty("--thread-scroll-visible", hasOverflow ? "1" : "0");
      wrapper.style.setProperty("--thread-scroll-thumb-height", `${thumbHeight}px`);
      wrapper.style.setProperty("--thread-scroll-thumb-top", `${thumbTop}px`);
    };
    const schedule = () => {
      if (frame !== null) {
        return;
      }
      frame = requestAnimationFrame(update);
    };
    update();
    thread.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resizeObserver?.observe(thread);
    return () => {
      thread.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      resizeObserver?.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [messages]);

  useEffect(() => {
    if (!jobId || !isJobDone) {
      return;
    }
    if (!manifest && !previewConfig) {
      return;
    }
    const title = (manifest?.inputs?.raw_prompt ?? latestPrompt).trim();
    const previewUri =
      manifest?.outputs?.scene?.panorama?.uri ?? previewConfig?.scene?.panorama_uri;
    const createdAt = manifest?.created_at ?? new Date().toISOString();
    const signature = JSON.stringify({
      jobId,
      title,
      previewUri: previewUri ?? "",
      createdAt,
    });
    if (recentSaveRef.current === signature) {
      return;
    }
    recentSaveRef.current = signature;
    const meta: { title?: string; createdAt?: string; previewUrl?: string } = {};
    if (title) {
      meta.title = title;
    }
    if (createdAt) {
      meta.createdAt = createdAt;
    }
    if (previewUri) {
      meta.previewUrl = previewUri;
    }
    saveRecentWork(jobId, meta);
    if (sessionId && sessionJobIdRef.current === jobId) {
      updateSessionIndex(sessionId, {
        previewUrl: previewUri ?? undefined,
        status: "done",
        updatedAt: new Date().toISOString(),
      });
    }
  }, [isJobDone, jobId, latestPrompt, manifest, previewConfig, sessionId]);

  const handleComplete = () => {
    setInspectorStage("complete");
    setActiveTab("preview");
  };

  return (
    <div className="page create-page">
      <div className="create-shell">
        <main className="create-chat">
          <div className="chat-header">
            <div className="chat-header-main">
              <div className="chat-title">创作助理</div>
              <div className="chat-subtitle">一句话描述场景，系统会在侧栏拆解风格与节奏。</div>
            </div>
            <div className="chat-header-right">
              <div className="chat-meta">
                <span className="meta-pill">Atlas-3 Preview</span>
                <span className="meta-pill">Storyboard</span>
              </div>
              <div className="chat-status">
                <span className="status-dot" aria-hidden="true" />
                在线
              </div>
            </div>
          </div>

          <div className="chat-panel">
            <div className="chat-thread-wrap" ref={chatThreadWrapRef}>
              <ul className="chat-thread" ref={chatThreadRef}>
                {messages.map((message) => (
                  <li key={message.id} className={`chat-message chat-message-${message.role}`}>
                    <div className="chat-message-content">{message.content}</div>
                  </li>
                ))}
              </ul>
              <div className="chat-thread-scroll" aria-hidden="true">
                <div className="chat-thread-scroll-thumb" />
              </div>
            </div>

            <form
              className="chat-input"
              onSubmit={(event) => {
                event.preventDefault();
                handleSend();
              }}
            >
              <div className="chat-input-field">
                <div className="chat-template-row">
                  {TEMPLATE_SNIPPETS.map((snippet) => (
                    <button
                      key={snippet.id}
                      type="button"
                      className="chat-template-button"
                      onClick={() => insertTemplate(snippet.template)}
                    >
                      {snippet.label}
                    </button>
                  ))}
                </div>
                <div className="chat-input-box" ref={chatInputBoxRef}>
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="描述你的场景、光线、动作与配乐..."
                    rows={3}
                  />
                  <div className="chat-input-scroll" aria-hidden="true">
                    <div className="chat-input-scroll-thumb" />
                  </div>
                  <button
                    type="submit"
                    className="send-button"
                    disabled={!canSend}
                    aria-label="发送"
                  >
                    <svg
                      className="button-icon"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d="M4 10h9"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                      <path
                        d="M10 5l5 5-5 5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
                <div className="chat-input-hint">Enter 发送，Shift + Enter 换行。</div>
              </div>
            </form>
          </div>
        </main>

        <aside className="create-inspector">
          <div className="inspector-card">
            <div className="inspector-header">
              <div>
                <div className="inspector-title">参数面板</div>
                <div className="inspector-subtitle">
                  {inspectorStage === "choosing_options" && "选择风格与节奏，让系统开始生成。"}
                  {inspectorStage === "running" && "生成中，正在整理场景与素材。"}
                  {inspectorStage === "complete" && "查看预览与导出设置。"}
                </div>
              </div>
              <div className="inspector-stage-pill">{INSPECTOR_STAGE_LABELS[inspectorStage]}</div>
            </div>

            <div className="inspector-steps">
              {INSPECTOR_STEPS.map((step, index) => {
                const status =
                  index === activeStepIndex ? "active" : index < activeStepIndex ? "complete" : "";
                return (
                  <div key={step.id} className={`inspector-step ${status}`}>
                    <span className="step-index">{index + 1}</span>
                    <span className="step-label">{step.label}</span>
                  </div>
                );
              })}
            </div>

            <div className="inspector-body">
              {inspectorStage === "choosing_options" && (
                <>
                  {!hasPrompt && (
                    <div className="inspector-callout">发送提示词以解锁生成参数。</div>
                  )}
                  <div className="inspector-section">
                    <div className="inspector-section-title">风格</div>
                    <div className="style-grid">
                      {STYLE_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`style-card ${selectedStyle === option.id ? "active" : ""}`}
                          onClick={() => setSelectedStyle(option.id)}
                        >
                          <div className="style-card-title">{option.title}</div>
                          <div className="style-card-description">{option.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="inspector-section">
                    <div className="inspector-section-title">情绪</div>
                    <div className="mood-row">
                      {MOOD_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`mood-chip ${selectedMood === option.id ? "active" : ""}`}
                          onClick={() => setSelectedMood(option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="inspector-section">
                    <div className="duration-row">
                      <div className="inspector-section-title">时长</div>
                      <div className="duration-value">{duration}s</div>
                    </div>
                    <input
                      className="duration-slider"
                      type="range"
                      min={5}
                      max={30}
                      step={1}
                      value={duration}
                      onChange={(event) => setDuration(Number(event.target.value))}
                    />
                    <div className="duration-hint">片段越短，生成速度越快。</div>
                  </div>

                  <div className="inspector-section advanced-settings">
                    <button
                      type="button"
                      className="advanced-toggle"
                      aria-expanded={advancedOpen}
                      aria-controls="advanced-settings"
                      onClick={() => setAdvancedOpen((prev) => !prev)}
                      ref={advancedToggleRef}
                    >
                      <span className="advanced-toggle-icon" aria-hidden="true" />
                      <span className="advanced-toggle-label">高级设置</span>
                    </button>
                    {advancedOpen && (
                      <div className="advanced-panel" id="advanced-settings" ref={advancedPanelRef}>
                        <label className="field-row">
                          <span>模型</span>
                          <SelectMenu
                            value={advancedSettings.model}
                            options={MODEL_OPTIONS}
                            ariaLabel="模型"
                            onChange={(value) =>
                              setAdvancedSettings((prev) => ({
                                ...prev,
                                model: value,
                              }))
                            }
                          />
                        </label>
                        <label className="field-row">
                          <span>随机种子</span>
                          <div className="seed-field">
                            <input
                              type="number"
                              min={0}
                              step={1}
                              placeholder="自动"
                              value={advancedSettings.seed}
                              onChange={(event) =>
                                setAdvancedSettings((prev) => ({
                                  ...prev,
                                  seed: event.target.value,
                                }))
                              }
                            />
                            <div className="seed-stepper">
                              <button
                                type="button"
                                className="seed-stepper-button"
                                onClick={() => adjustSeed(1)}
                                aria-label="增加随机种子"
                              >
                                <svg viewBox="0 0 12 12" aria-hidden="true">
                                  <path
                                    d="M3 7l3-3 3 3"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.4"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="seed-stepper-button"
                                onClick={() => adjustSeed(-1)}
                                aria-label="减少随机种子"
                              >
                                <svg viewBox="0 0 12 12" aria-hidden="true">
                                  <path
                                    d="M3 5l3 3 3-3"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.4"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </label>
                        <label className="field-row">
                          <span>分辨率</span>
                          <SelectMenu
                            value={advancedSettings.resolution}
                            options={RESOLUTION_SELECT_OPTIONS}
                            ariaLabel="分辨率"
                            onChange={(value) =>
                              setAdvancedSettings((prev) => ({
                                ...prev,
                                resolution: value,
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="primary-button"
                    disabled={!hasPrompt || isStarting || isJobActive}
                    onClick={handleStartGeneration}
                  >
                    <span>开始生成</span>
                    <svg className="button-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <path d="M6 4l10 6-10 6z" fill="currentColor" />
                    </svg>
                  </button>
                </>
              )}

              {inspectorStage === "running" && (
                <>
                <div className="inspector-progress">
                  <div className="progress-header">
                    <div>
                      <div className="progress-title">生成进度</div>
                      <div className="progress-subtitle">阶段：{progressStage}</div>
                      <div className="progress-meta">队列位置：{queueLabel}</div>
                    </div>
                    <div className="progress-value">{progressLabel}</div>
                  </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${progressValue}%` }} />
                    </div>
                  </div>

                  <div className="log-panel">
                    <div className="log-panel-title">实时日志</div>
                    <ul className="log-list">
                      {logLines.map((line, index) => (
                        <li key={`${index}-${line}`}>{line}</li>
                      ))}
                    </ul>
                  </div>

                  <button type="button" className="ghost-button" onClick={handleComplete}>
                    <span>查看结果</span>
                    <svg className="button-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <path
                        d="M4 10h9"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                      <path
                        d="M10 5l5 5-5 5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </>
              )}

              {inspectorStage === "complete" && (
                <>
                  <div className="inspector-tabs">
                    {INSPECTOR_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={`inspector-tab ${activeTab === tab.id ? "active" : ""}`}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="inspector-tab-content">
                    {activeTab === "preview" && (
                      <>
                        {previewConfig ? (
                          <div className="preview-panel-wrapper">
                            <PreviewPanel
                              jobId={jobId ?? undefined}
                              config={previewConfig}
                              emptyMessage="预览配置已加载"
                            />
                          </div>
                        ) : (
                          <div className="preview-fallback">
                            {previewConfigMissing && (
                              <div className="preview-fallback-banner">
                                后端尚未生成 preview_config，已降级为资源链接。
                              </div>
                            )}
                            {assetError && (
                              <div className="preview-fallback-banner preview-fallback-error">
                                {assetError}
                              </div>
                            )}
                            {isLoadingAssets && (
                              <div className="preview-placeholder-screen">
                                <div className="preview-placeholder-hint">正在加载预览资源...</div>
                              </div>
                            )}
                            {!isLoadingAssets && (
                              <>
                                <div className="preview-placeholder-screen">
                                  <div className="preview-placeholder-hint">预览配置不可用</div>
                                </div>
                                <div className="preview-placeholder-meta">
                                  <div className="preview-placeholder-title">可用资源</div>
                                  <div className="preview-placeholder-subtitle">
                                    点击以下链接打开或下载。
                                  </div>
                                </div>
                                <div className="preview-link-list">
                                  {previewLinks.length > 0 ? (
                                    previewLinks.map((item) => (
                                      <a
                                        key={item.id}
                                        href={item.href}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="preview-link"
                                      >
                                        {item.label}
                                      </a>
                                    ))
                                  ) : (
                                    <div className="preview-placeholder-subtitle">
                                      暂无可用预览资源。
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {audioPreviewSrc ? (
                          <div className="preview-audio">
                            <div className="preview-audio-title">音频预览</div>
                            <audio controls src={audioPreviewSrc} preload="none" />
                          </div>
                        ) : (
                          <div className="preview-audio-empty">暂无音频</div>
                        )}
                      </>
                    )}
                    {activeTab === "assets" && (
                      <div className="assets-panel">
                        {isLoadingAssets && (
                          <div className="inspector-callout">正在加载资产清单...</div>
                        )}
                        {!isLoadingAssets && assetError && (
                          <div className="inspector-callout">{assetError}</div>
                        )}
                        {!isLoadingAssets && assetDownloads.length === 0 && (
                          <div className="inspector-callout">暂无可下载资源。</div>
                        )}
                        {!isLoadingAssets && assetDownloads.length > 0 && (
                          <div className="placeholder-grid">
                            {assetDownloads.map((item) => (
                              <div key={item.id} className="placeholder-card">
                                <div className="placeholder-title">{item.label}</div>
                                <a
                                  className="asset-link"
                                  href={item.href}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  打开/下载
                                </a>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {activeTab === "export" && (
                      <div className="export-panel">
                        <div className="export-settings">
                          <label className="export-field">
                            <span>导出预设</span>
                            <SelectMenu
                              value={exportPreset}
                              options={EXPORT_SELECT_OPTIONS}
                              ariaLabel="导出预设"
                              onChange={setExportPreset}
                            />
                          </label>
                        </div>
                        <div className="export-actions">
                          {exportMp4 ? (
                            <a className="primary-button export-button" href={exportMp4.href} download>
                              导出视频
                            </a>
                          ) : (
                            <button type="button" className="primary-button export-button" disabled>
                              导出视频
                            </button>
                          )}
                          <div className="export-note">
                            {exportMp4
                              ? "视频已生成，可直接下载。"
                              : "导出资源尚未生成或导出服务未接入。"}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};




