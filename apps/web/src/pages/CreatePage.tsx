import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

import { PreviewPanel } from "../components/preview/PreviewPanel";
import { useJobRunner } from "../hooks/useJobRunner";
import { fetchManifest, fetchPreviewConfig, getAssetUrl } from "../lib/api";
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

const ROLE_LABELS: Record<MessageRole, string> = {
  user: "你",
  system: "系统",
  tool: "工具",
  result: "结果",
};

const INSPECTOR_STAGE_LABELS: Record<InspectorStage, string> = {
  choosing_options: "参数",
  running: "生成中",
  complete: "交付",
};

const STYLE_OPTIONS = [
  {
    id: "cinematic",
    title: "电影感",
    description: "高对比灯光与大景别构图。",
  },
  {
    id: "studio",
    title: "棚拍",
    description: "干净布光、均衡曝光、清晰色彩。",
  },
  {
    id: "noir",
    title: "黑色电影",
    description: "冷冽阴影与克制的反差。",
  },
  {
    id: "anime",
    title: "动漫",
    description: "线条化渲染与高饱和色彩。",
  },
];

const MOOD_OPTIONS = [
  { id: "calm", label: "平静" },
  { id: "energetic", label: "充沛" },
  { id: "dreamy", label: "梦幻" },
];

const INSPECTOR_STEPS = [
  { id: "options", label: "参数" },
  { id: "running", label: "生成" },
  { id: "review", label: "交付" },
];

const INSPECTOR_TABS = [
  { id: "preview", label: "Preview" },
  { id: "assets", label: "Assets" },
  { id: "export", label: "Export" },
] as const;

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "system-1",
    role: "system",
    content: "我是你的创作助理，会把你的描述拆解成镜头、情绪与节奏。",
  },
  {
    id: "tool-1",
    role: "tool",
    content: "右侧面板已准备好记录风格与参数。",
  },
  {
    id: "result-1",
    role: "result",
    content: "发送一句话描述，开始构建场景。",
  },
];

export const CreatePage = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");
  const [inspectorStage, setInspectorStage] = useState<InspectorStage>("choosing_options");
  const [selectedStyle, setSelectedStyle] = useState(STYLE_OPTIONS[0].id);
  const [selectedMood, setSelectedMood] = useState(MOOD_OPTIONS[0].id);
  const [duration, setDuration] = useState(14);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedSettings, setAdvancedSettings] = useState({
    cinematicCamera: true,
    ambientAudio: true,
    detailBoost: false,
  });
  const [activeTab, setActiveTab] = useState<InspectorTab>("preview");
  const [toolMessageId, setToolMessageId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [previewConfig, setPreviewConfig] = useState<PreviewConfig | null>(null);
  const [previewConfigMissing, setPreviewConfigMissing] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const assetsJobRef = useRef<string | null>(null);

  const latestPrompt = useMemo(() => {
    const match = [...messages].reverse().find((message) => message.role === "user");
    return match?.content ?? "";
  }, [messages]);
  const hasPrompt = latestPrompt.trim().length > 0;
  const canSend = draft.trim().length > 0;
  const jobOptions = useMemo(
    () => ({
      style: selectedStyle,
      mood: selectedMood,
      duration_s: duration,
      advanced: advancedSettings,
    }),
    [advancedSettings, duration, selectedMood, selectedStyle]
  );
  const {
    jobId,
    jobStatus,
    error: jobError,
    isStarting,
    start: startJob,
  } = useJobRunner(latestPrompt, jobOptions);

  const activeStepIndex =
    inspectorStage === "complete" ? 2 : inspectorStage === "running" ? 1 : 0;

  const progressValue =
    typeof jobStatus?.progress === "number"
      ? Math.max(0, Math.min(100, Math.round(jobStatus.progress)))
      : 0;
  const progressLabel = typeof jobStatus?.progress === "number" ? `${progressValue}%` : "--";
  const progressStage = jobStatus?.stage ?? jobStatus?.status ?? "准备中";
  const logLines =
    jobStatus?.logs_tail && jobStatus.logs_tail.length > 0
      ? jobStatus.logs_tail
      : jobStatus?.message
        ? [jobStatus.message]
        : ["等待日志输出..."];
  const normalizedJobStatus = jobStatus?.status?.toUpperCase() ?? "";
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
    addItem("预览 MP4", outputs?.export?.mp4?.uri, "mp4");
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
    const hint = jobStatus.message ? ` · ${jobStatus.message}` : "";
    return `生成中 ${progressLabel} · ${progressStage}${hint}`;
  }, [jobError, jobId, jobStatus, progressLabel, progressStage, toolMessageId]);

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, role: "user", content: trimmed },
    ]);
    setDraft("");
    setInspectorStage("choosing_options");
  };

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

  const handleStartGeneration = async () => {
    if (!hasPrompt) {
      return;
    }
    const toolId = `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMessages((prev) => [
      ...prev,
      { id: toolId, role: "tool", content: "正在创建任务..." },
    ]);
    setToolMessageId(toolId);
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
      setInspectorStage("choosing_options");
    }
  };

  const handleComplete = () => {
    setInspectorStage("complete");
    setActiveTab("preview");
  };

  return (
    <div className="page create-page">
      <div className="create-shell">
        <aside className="create-sidebar">
          <div className="sidebar-brand">
            <div className="brand-mark" aria-hidden="true" />
            <div>
              <div className="brand-title">Genesis Studio</div>
              <div className="brand-subtitle">Creative Console</div>
            </div>
          </div>
          <nav className="sidebar-nav">
            <NavLink end to="/" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
              <span className="nav-dot" aria-hidden="true" />
              创作
            </NavLink>
            <NavLink to="/works" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
              <span className="nav-dot" aria-hidden="true" />
              作品库
            </NavLink>
          </nav>
          <div className="sidebar-panel">
            <div className="sidebar-panel-title">Session</div>
            <div className="sidebar-panel-item">Model: Atlas-3 Preview</div>
            <div className="sidebar-panel-item">Mode: Storyboard</div>
          </div>
        </aside>

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
            <ul className="chat-thread">
              {messages.map((message) => (
                <li key={message.id} className={`chat-message chat-message-${message.role}`}>
                  <div className="chat-message-meta">{ROLE_LABELS[message.role]}</div>
                  <div className="chat-message-content">{message.content}</div>
                </li>
              ))}
            </ul>

            <form
              className="chat-input"
              onSubmit={(event) => {
                event.preventDefault();
                handleSend();
              }}
            >
              <div className="chat-input-field">
                <textarea
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
                <div className="chat-input-hint">Enter 发送，Shift + Enter 换行。</div>
              </div>
              <button type="submit" className="send-button" disabled={!canSend}>
                <span>发送</span>
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
            </form>
          </div>
        </main>

        <aside className="create-inspector">
          <div className="inspector-card">
            <div className="inspector-header">
              <div>
                <div className="inspector-title">Inspector</div>
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
                      min={6}
                      max={30}
                      step={1}
                      value={duration}
                      onChange={(event) => setDuration(Number(event.target.value))}
                    />
                    <div className="duration-hint">片段越短，生成速度越快。</div>
                  </div>

                  <div className="inspector-section">
                    <button
                      type="button"
                      className="advanced-toggle"
                      aria-expanded={advancedOpen}
                      aria-controls="advanced-settings"
                      onClick={() => setAdvancedOpen((prev) => !prev)}
                    >
                      高级设置
                      <span className="advanced-toggle-icon" aria-hidden="true" />
                    </button>
                    {advancedOpen && (
                      <div className="advanced-panel" id="advanced-settings">
                        <label className="toggle-row">
                          <input
                            type="checkbox"
                            checked={advancedSettings.cinematicCamera}
                            onChange={(event) =>
                              setAdvancedSettings((prev) => ({
                                ...prev,
                                cinematicCamera: event.target.checked,
                              }))
                            }
                          />
                          电影级镜头运动
                        </label>
                        <label className="toggle-row">
                          <input
                            type="checkbox"
                            checked={advancedSettings.ambientAudio}
                            onChange={(event) =>
                              setAdvancedSettings((prev) => ({
                                ...prev,
                                ambientAudio: event.target.checked,
                              }))
                            }
                          />
                          环境音铺底
                        </label>
                        <label className="toggle-row">
                          <input
                            type="checkbox"
                            checked={advancedSettings.detailBoost}
                            onChange={(event) =>
                              setAdvancedSettings((prev) => ({
                                ...prev,
                                detailBoost: event.target.checked,
                              }))
                            }
                          />
                          细节增强
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
                        <div className="progress-title">生成中</div>
                        <div className="progress-subtitle">阶段：{progressStage}</div>
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
                              emptyMessage="预览配置已加载。"
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
                        {!isLoadingAssets && assetItems.length === 0 && (
                          <div className="inspector-callout">暂无可下载资源。</div>
                        )}
                        {!isLoadingAssets && assetItems.length > 0 && (
                          <div className="placeholder-grid">
                            {assetItems.map((item) => (
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
                        <div className="inspector-callout">后端未实现则置灰。</div>
                        <div className="placeholder-grid export-disabled">
                          <div className="placeholder-card">
                            <div className="placeholder-title">打包下载</div>
                            <div className="placeholder-meta">ZIP Bundle - 禁用</div>
                          </div>
                          <div className="placeholder-card">
                            <div className="placeholder-title">分享链接</div>
                            <div className="placeholder-meta">Public URL - 禁用</div>
                          </div>
                          <div className="placeholder-card">
                            <div className="placeholder-title">发布画廊</div>
                            <div className="placeholder-meta">需要审核</div>
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
