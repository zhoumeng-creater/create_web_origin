// src/pages/GenerateBvh.tsx
import React, { useEffect, useRef, useState } from "react";
import { Card, Form, Input, Button, Progress, Space, Tag, message } from "antd";

const API_BASE = "http://localhost:8000";

type JobStatus = "IDLE" | "RUNNING" | "QUEUED" | "COMPLETED" | "FAILED";

export default function GenerateBvh() {
  const [form] = Form.useForm();

  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("IDLE");

  // 后端给的“真实目标进度”
  const [targetProgress, setTargetProgress] = useState(0);
  // 前端“平滑显示”的进度
  const [displayProgress, setDisplayProgress] = useState(0);

  // 单行提示（后端 hint）与最近提示（后端 hints，最多 20 条）
  const [hint, setHint] = useState("");
  const [hints, setHints] = useState<string[]>([]);
  const [hintIndex, setHintIndex] = useState(0);

  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const onFinish = async (v: any) => {
    setSubmitting(true);
    setStatus("QUEUED");
    setTargetProgress(0);
    setDisplayProgress(0);
    setDownloadUrl(null);
    setHint("");
    setHints([]);
    setHintIndex(0);

    try {
      const resp = await fetch(`${API_BASE}/bvh/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: v.text }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const id = data.job_id as string;
      setJobId(id);
      message.success(`已创建任务：${id}`);

      // 连接 WS
      wsRef.current?.close();
      const ws = new WebSocket(`${API_BASE.replace("http", "ws")}/ws/jobs/${id}`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (typeof msg.progress === "number") {
            setTargetProgress(Math.max(0, Math.min(100, msg.progress)));
          }
          if (msg.status) setStatus(msg.status as JobStatus);
          if (msg.download_url) setDownloadUrl(`${API_BASE}${msg.download_url}`);

          if (typeof msg.hint === "string") setHint(msg.hint);
          if (Array.isArray(msg.hints)) {
            const arr = msg.hints.slice(-20);
            setHints(arr);
            setHintIndex(Math.max(0, arr.length - 1));
          }
        } catch {}
      };
      ws.onclose = () => (wsRef.current = null);
    } catch (e: any) {
      message.error(e?.message || "创建任务失败");
      setStatus("IDLE");
    } finally {
      setSubmitting(false);
    }
  };

  // 进度平滑动画（修正点：不超过目标 +3%，且上限 98）
  useEffect(() => {
    if (status === "COMPLETED") {
      setDisplayProgress(100);
      return;
    }
    if (status === "FAILED" || status === "IDLE") return;

    const timer = setInterval(() => {
      setDisplayProgress((cur) => {
        const tgt = targetProgress;
        // 允许的“临时上限”（不要跑太快）
        const allowedCeil = Math.min(98, tgt + 3);

        let aim = tgt;
        if (cur < allowedCeil) {
          // 缓缓向 allowedCeil 逼近
          aim = Math.min(allowedCeil, cur + 0.35);
        } else {
          // 如果跑快了，缓慢回到 tgt
          aim = Math.max(tgt, cur - 0.5);
        }

        // 小步收敛
        const diff = aim - cur;
        if (Math.abs(diff) < 0.15) return aim;
        const step = Math.max(0.3, diff * 0.2);
        return Math.max(0, Math.min(100, cur + step));
      });
    }, 120);

    return () => clearInterval(timer);
  }, [targetProgress, status]);

  // 字幕轮换：每 1.5 秒切换到下一条，仅显示一条
  useEffect(() => {
    if (!hints.length) return;
    const t = setInterval(() => {
      setHintIndex((i) => (i + 1) % hints.length);
    }, 1500);
    return () => clearInterval(t);
  }, [hints]);

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

  // 当前展示的字幕（优先后端最新 hint，其次 hints 轮播项）
  const displayHint = hint || (hints.length ? hints[hintIndex] : "");

  // 修正点：未完成时永远不显示 100%
  const progressForShow =
    status === "COMPLETED" ? 100 : Math.min(99, Math.floor(displayProgress));

  return (
    <Card title="文本 → BVH" style={{ maxWidth: 720 }}>
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="text" label="文本" rules={[{ required: true, message: "请输入文本" }]}>
          <Input.TextArea rows={6} placeholder="在此输入动作描述…" />
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
          {/* 进度条上方“一行小提示” */}
          <div style={{ marginBottom: 6, minHeight: 22, color: "#666" }}>
            {displayHint ? `· ${displayHint}` : "· 正在准备…"}
          </div>

          <Progress
            percent={progressForShow}
            status={status === "FAILED" ? "exception" : "active"}
            showInfo
          />

          {status === "COMPLETED" && downloadUrl && (
            <div style={{ marginTop: 12 }}>
              <Button type="link">
                <a href={downloadUrl} download>
                  下载 BVH 文件
                </a>
              </Button>
            </div>
          )}

          {status === "FAILED" && (
            <div style={{ marginTop: 10, color: "#d4380d" }}>任务失败（查看上方提示）</div>
          )}
        </div>
      )}
    </Card>
  );
}
