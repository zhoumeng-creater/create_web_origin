// src/pages/GenerateMp4.tsx
import React, { useEffect, useRef, useState } from "react";
import { Card, Form, Input, Button, Progress, Space, Tag, message } from "antd";
import { API_BASE } from "../lib/api";

type JobStatus = "IDLE" | "RUNNING" | "QUEUED" | "COMPLETED" | "FAILED";

export default function GenerateMp4() {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("IDLE");
  const statusRef = useRef<JobStatus>("IDLE"); // 修复：用 ref 保存最新状态
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
  const [mp4List, setMp4List] = useState<string[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // 提交任务
  const onFinish = async (v: { text: string }) => {
    setSubmitting(true);
    setTargetProgress(0);
    setDisplayProgress(0);
    setStatus("QUEUED");
    setPreviewUrl(null);
    setMp4List([]);
    setErrorText(null);
    setHint("");
    setJobId(null);

    try {
      const resp = await fetch(`${API_BASE}/mp4/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: v.text }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const id = data.job_id as string;
      setJobId(id);
      message.success(`已创建任务：${id}`);

      // 订阅进度
      wsRef.current?.close();
      const ws = new WebSocket(`${API_BASE.replace(/^http/, "ws")}/ws/jobs/${id}`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);

          // 先更新状态
          let newStatus: JobStatus = statusRef.current;
          if (msg.status) {
            newStatus = msg.status as JobStatus;
            setStatus(newStatus);
          }

          // 再按状态钳制目标进度（未完成最高 98；完成允许 100）
          if (typeof msg.progress === "number") {
            const cap = newStatus === "COMPLETED" ? 100 : 98;
            const nextTarget = Math.max(0, Math.min(cap, msg.progress));
            setTargetProgress(nextTarget);
          }

          if (typeof msg.hint === "string") setHint(msg.hint);
          if (msg.preview_url) setPreviewUrl(`${API_BASE}${msg.preview_url}`);
          if (Array.isArray(msg.mp4_list)) setMp4List(msg.mp4_list.map((p: string) => `${API_BASE}${p}`));
          if (msg.error) setErrorText(String(msg.error));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
      };
    } catch (e: any) {
      message.error(e?.message || "创建任务失败");
      setStatus("IDLE");
    } finally {
      setSubmitting(false);
    }
  };

  // 进度平滑动画（未完成时任何情况下都钳到 98）
  useEffect(() => {
    if (status === "COMPLETED") {
      setDisplayProgress(100);
      return;
    }
    if (status === "FAILED") {
      setDisplayProgress(targetProgress);
      return;
    }
    if (status === "IDLE") return;

    const timer = setInterval(() => {
      setDisplayProgress((cur) => {
        // 从 ref 读取最新状态，避免闭包过期 & 消除报错
        const s = statusRef.current;

        // 未完成时的有效目标
        const effectiveTarget = s === "COMPLETED" ? targetProgress : Math.min(98, targetProgress);

        // 允许稍微领先，但不超过 98 且不超过目标 +3%
        const allowedCeil = Math.min(98, effectiveTarget + 3);

        let aim = effectiveTarget;
        if ((s === "RUNNING" || s === "QUEUED") && cur >= effectiveTarget - 0.1 && cur < allowedCeil) {
          aim = Math.min(allowedCeil, cur + 0.35);
        } else if (cur > allowedCeil) {
          // 跑太快了，稍微回落一点
          aim = Math.max(effectiveTarget, cur - 0.5);
        }

        const diff = aim - cur;
        if (Math.abs(diff) < 0.15) return aim;
        const step = Math.max(0.3, diff * 0.2);
        const next = cur + step;

        return Math.max(0, Math.min(s === "COMPLETED" ? 100 : 98, next));
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
  const shownPercent =
    status === "COMPLETED" ? Math.round(displayProgress) : Math.min(98, Math.floor(displayProgress));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
      {/* 左侧：表单 + 进度 */}
      <Card title="文本 → MP4">
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="text" label="文本" rules={[{ required: true, message: "请输入文本" }]}>
            <Input.TextArea rows={6} placeholder="在此输入动作/场景描述…" />
          </Form.Item>

          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              disabled={status === "RUNNING" || status === "QUEUED"}
            >
              提交任务
            </Button>
            {StatusTag}
          </Space>
        </Form>

        {status !== "IDLE" && (
          <div style={{ marginTop: 20 }}>
            {/* 进度条上方——单行实时日志 */}
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

      {/* 右侧：视频预览区（完成后显示） */}
      <Card title="预览" bodyStyle={{ padding: 8, background: "#111" }}>
        {status === "COMPLETED" && previewUrl ? (
          <video
            key={previewUrl}
            src={previewUrl}
            controls
            style={{ width: "100%", borderRadius: 6, background: "#000" }}
          />
        ) : (
          <div
            style={{
              color: "#bbb",
              height: 360,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#000",
              borderRadius: 6,
            }}
          >
            {status === "RUNNING" || status === "QUEUED" ? "正在生成视频…" : "生成完成后在此处预览"}
          </div>
        )}

        {/* 可选：列出全部生成视频的下载链接 */}
        {mp4List.length > 0 && (
          <div style={{ marginTop: 12, color: "#ddd" }}>
            <div style={{ marginBottom: 6 }}>生成的文件</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {mp4List.map((u) => (
                <li key={u}>
                  <a href={u} download>
                    {decodeURIComponent(u.split("/").pop() || "video.mp4")}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
