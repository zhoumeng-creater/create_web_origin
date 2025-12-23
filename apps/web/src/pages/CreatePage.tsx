import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

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

const MOCK_LOGS = [
  "任务已进入队列，正在分配渲染资源。",
  "解析提示词并拆解镜头节奏。",
  "生成运动骨骼与镜头路径。",
  "渲染关键帧与环境层。",
  "混合环境音与氛围配乐。",
  "整理预览与可导出素材。",
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

  const latestPrompt = useMemo(() => {
    const match = [...messages].reverse().find((message) => message.role === "user");
    return match?.content ?? "";
  }, [messages]);
  const hasPrompt = latestPrompt.trim().length > 0;
  const canSend = draft.trim().length > 0;

  const activeStepIndex =
    inspectorStage === "complete" ? 2 : inspectorStage === "running" ? 1 : 0;

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

  const handleStartGeneration = () => {
    const options = {
      style: selectedStyle,
      mood: selectedMood,
      duration_s: duration,
      advanced: advancedSettings,
    };
    console.log(latestPrompt, options);
    setInspectorStage("running");
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
                    disabled={!hasPrompt}
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
                        <div className="progress-subtitle">阶段：渲染场景层</div>
                      </div>
                      <div className="progress-value">68%</div>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: "68%" }} />
                    </div>
                  </div>

                  <div className="log-panel">
                    <div className="log-panel-title">实时日志</div>
                    <ul className="log-list">
                      {MOCK_LOGS.map((line) => (
                        <li key={line}>{line}</li>
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
                      <div className="preview-placeholder">
                        <div className="preview-placeholder-screen">
                          <div className="preview-placeholder-hint">预览将在此显示</div>
                        </div>
                        <div className="preview-placeholder-meta">
                          <div className="preview-placeholder-title">预览画面</div>
                          <div className="preview-placeholder-subtitle">
                            生成完成后将自动加载时间轴与镜头信息。
                          </div>
                        </div>
                        <div className="preview-placeholder-tags">
                          <span className="meta-pill">16:9</span>
                          <span className="meta-pill">4K</span>
                          <span className="meta-pill">60fps</span>
                        </div>
                      </div>
                    )}
                    {activeTab === "assets" && (
                      <div className="placeholder-grid">
                        <div className="placeholder-card">
                          <div className="placeholder-title">场景全景</div>
                          <div className="placeholder-meta">4096 x 2048 - 待生成</div>
                        </div>
                        <div className="placeholder-card">
                          <div className="placeholder-title">动作捕捉</div>
                          <div className="placeholder-meta">BVH - 待生成</div>
                        </div>
                        <div className="placeholder-card">
                          <div className="placeholder-title">配乐轨道</div>
                          <div className="placeholder-meta">WAV - 待生成</div>
                        </div>
                      </div>
                    )}
                    {activeTab === "export" && (
                      <div className="placeholder-grid">
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
