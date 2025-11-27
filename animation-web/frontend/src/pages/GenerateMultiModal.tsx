// src/pages/GenerateMultiModal.tsx
import React, { useEffect, useRef, useState } from "react";
import { Card, Form, Input, Button, Progress, Space, Tag, message } from "antd";
import { API_BASE } from "../lib/api";

type JobStatus = "IDLE" | "RUNNING" | "QUEUED" | "COMPLETED" | "FAILED";

interface ComboJobMessage {
  status?: JobStatus;
  progress?: number;
  hint?: string;
  preview_url?: string;
  mp4_list?: string[];
  bvh_download_url?: string;
  audio_url?: string;
  error?: string;
}

const withCacheBuster = (u: string) => `${u}${u.includes("?") ? "&" : "?"}t=${Date.now()}`;

export default function GenerateMultiModal() {
  const [form] = Form.useForm();

  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("IDLE");
  const statusRef = useRef<JobStatus>("IDLE");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // 后端推送的“目标进度”（受状态钳制）
  const [targetProgress, setTargetProgress] = useState(0);
  // 前端平滑显示的进度
  const [displayProgress, setDisplayProgress] = useState(0);

  // 单行实时日志（后端 hint）
  const [hint, setHint] = useState<string>("");

  // 结果
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [bvhUrl, setBvhUrl] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // ★ 新增：video / audio 引用，用于同步播放
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 提交任务
  const onFinish = async (v: { text: string }) => {
    const text = (v.text || "").trim();
    if (!text) {
      message.warning("请输入战斗文本和音乐描述");
      return;
    }

    setSubmitting(true);
    setTargetProgress(0);
    setDisplayProgress(0);
    setStatus("QUEUED");
    setPreviewUrl(null);
    setAudioUrl(null);
    setBvhUrl(null);
    setErrorText(null);
    setHint("");
    setJobId(null);

    try {
      const resp = await fetch(`${API_BASE}/combo/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const id = data.job_id as string;
      setJobId(id);
      message.success(`已创建多模态任务：${id}`);

      // 订阅进度
      wsRef.current?.close();
      const ws = new WebSocket(`${API_BASE.replace(/^http/, "ws")}/ws/jobs/${id}`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg: ComboJobMessage = JSON.parse(ev.data);

          // 先更新状态
          let newStatus: JobStatus = statusRef.current;
          if (msg.status) {
            newStatus = msg.status as JobStatus;
            setStatus(newStatus);
          }

          // 再按状态钳制目标进度（未完成最高 98；完成允许 100）
          // 直接按后端进度设置目标值（0~100），不再人为封顶 98
          if (typeof msg.progress === "number") {
              const nextTarget = Math.max(0, Math.min(100, msg.progress));
              setTargetProgress(nextTarget);
          }

          // 如果明确收到 COMPLETED，就把目标强制到 100
          if (newStatus === "COMPLETED") {
              setTargetProgress(100);
          }

          if (typeof msg.hint === "string") setHint(msg.hint);
          if (msg.preview_url) setPreviewUrl(`${API_BASE}${msg.preview_url}`);
          if (msg.audio_url) setAudioUrl(withCacheBuster(`${API_BASE}${msg.audio_url}`));
          if (msg.bvh_download_url) setBvhUrl(`${API_BASE}${msg.bvh_download_url}`);
          if (msg.error) setErrorText(String(msg.error));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
      };
    } catch (e: any) {
      console.error(e);
      message.error(e?.message || "创建多模态任务失败");
      setStatus("IDLE");
    } finally {
      setSubmitting(false);
    }
  };

  // 平滑动画（未完成时任何情况下都钳到 98）
  useEffect(() => {
    if (status === "IDLE") return;
  
    // 失败时直接停在当前目标进度
    if (status === "FAILED") {
      setDisplayProgress(targetProgress);
      return;
    }
  
    const timer = setInterval(() => {
      setDisplayProgress((cur) => {
        const s = statusRef.current;
  
        // 运行中：最多先显示到 99，避免在 100 卡住；
        // 完成时：目标就是 100。
        let effectiveTarget = targetProgress;
        if (s !== "COMPLETED") {
          effectiveTarget = Math.min(99, effectiveTarget);
        } else {
          effectiveTarget = 100;
        }
  
        // 已经到达或超过目标
        if (cur >= effectiveTarget) {
          // 已完成但还没到 100 时，缓慢补齐
          if (s === "COMPLETED" && cur < 100) {
            return Math.min(100, cur + 1.0);
          }
          return cur;
        }
  
        // 朝目标缓慢前进
        const diff = effectiveTarget - cur;
        const step = Math.max(0.3, diff * 0.25); // 差距大就走大步，差距小时慢慢走
        const next = cur + step;
        return Math.min(effectiveTarget, next);
      });
    }, 120);
  
    return () => clearInterval(timer);
  }, [targetProgress, status]);
  

  // 退出页时关闭 WS
  useEffect(() => () => wsRef.current?.close(), []);

  const StatusTag = (
    <Tag
      color={
        status === "COMPLETED"
          ? "green"
          : status === "FAILED"
          ? "red"
          : status === "RUNNING"
          ? "blue"
          : status === "QUEUED"
          ? "gold"
          : "default"
      }
    >
      {status}
    </Tag>
  );

  // 显示用进度：未完成 -> floor 到 98；完成 -> round 到 100
  // 显示用进度：统一四舍五入到整数，0~100 之间
  const shownPercent = Math.max(0, Math.min(100, Math.round(displayProgress)));
  // ★ 关键：同步播放逻辑（用 video 的播放键同时控制音频）
  const handleVideoPlay = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!a || !v) return;

    // 启播前先对齐时间
    a.currentTime = v.currentTime;

    const p = a.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        // 有些浏览器可能拦截自动播放，忽略报错即可
      });
    }
  };

  const handleVideoPause = () => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
  };

  const handleVideoTimeUpdate = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    const diff = Math.abs(a.currentTime - v.currentTime);
    // 容忍 0.1 秒的误差，超过就强制对齐
    if (diff > 0.1) {
      a.currentTime = v.currentTime;
    }
  };

  const handleVideoEnded = () => {
    const a = audioRef.current;
    const v = videoRef.current;
    if (!a || !v) return;
    a.pause();
    a.currentTime = v.currentTime;
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.1fr", gap: 16, alignItems: "start" }}>
      {/* 左侧：输入 + 进度 */}
      <Card title="战斗文本 + 音乐文本 → 动画 + 音乐 + BVH">
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            name="text"
            label="输入文本"
            rules={[{ required: true, message: "请输入战斗文本和音乐描述" }]}
            extra='示例：A warrior dashes forward and slashes the enemy. in epic orchestral battle music, fast tempo'
          >
            <Input.TextArea
              rows={6}
              placeholder="先写战斗文本，再用 in 描述背景音乐，例如：A attacks B fiercely in epic orchestral battle music…"
            />
          </Form.Item>

          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              disabled={status === "RUNNING" || status === "QUEUED"}
            >
              提交多模态任务
            </Button>
            {StatusTag}
            {jobId && <span style={{ fontSize: 12, color: "#999" }}>任务 ID：{jobId}</span>}
          </Space>
        </Form>

        {status !== "IDLE" && (
          <div style={{ marginTop: 20 }}>
            <div style={{ marginBottom: 8, color: "#555", minHeight: 22 }}>
              · {hint || (status === "FAILED" ? "任务失败" : "正在准备…")}
            </div>
            <div style={{ marginBottom: 8 }}>进度：{shownPercent}%</div>
            <Progress
              percent={shownPercent}
              status={status === "FAILED" ? "exception" : "active"}
              showInfo={false}
            />
            {status === "FAILED" && (
              <div style={{ marginTop: 12, color: "#d4380d" }}>
                任务失败：{errorText || "请查看后端日志"}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 右侧：结果预览 */}
      <Card title="结果预览" bodyStyle={{ padding: 12 }}>
        {/* 视频（主控：这一个播放键控制视频+音频） */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}>视频预览（带同步背景音乐）</div>
          {status === "COMPLETED" && previewUrl ? (
            <video
              ref={videoRef}
              key={previewUrl}
              src={previewUrl}
              controls
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onTimeUpdate={handleVideoTimeUpdate}
              onEnded={handleVideoEnded}
              style={{ width: "100%", borderRadius: 6, background: "#000" }}
            />
          ) : (
            <div
              style={{
                color: "#bbb",
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#000",
                borderRadius: 6,
                marginBottom: 4,
              }}
            >
              {status === "RUNNING" || status === "QUEUED" ? "正在生成视频…" : "生成完成后在此处预览视频"}
            </div>
          )}
        </div>

        {/* 音频：隐藏播放器，只作为“跟随者”；保留下载链接 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}>背景音乐</div>
          {status === "COMPLETED" && audioUrl ? (
            <>
              {/* 隐藏实际播放的 audio，只用 video 控制 */}
              <audio ref={audioRef} src={audioUrl} style={{ display: "none" }} />
              <a href={audioUrl} download style={{ fontSize: 12 }}>
                下载背景音乐音频
              </a>
            </>
          ) : (
            <div style={{ color: "#888", fontSize: 13 }}>
              {status === "RUNNING" || status === "QUEUED" ? "正在生成音乐…" : "生成完成后可在此处下载背景音乐"}
            </div>
          )}
        </div>

        {/* BVH 下载 */}
        <div>
          <div style={{ marginBottom: 6 }}>BVH 文件</div>
          {status === "COMPLETED" && bvhUrl ? (
            <a href={bvhUrl} download>
              下载 BVH 文件
            </a>
          ) : (
            <span style={{ color: "#888", fontSize: 13 }}>生成完成后可在此处下载 BVH 文件</span>
          )}
        </div>
      </Card>
    </div>
  );
}
