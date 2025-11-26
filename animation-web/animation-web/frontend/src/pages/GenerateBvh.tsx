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

  // 来自后端的“真实进度”
  const [targetProgress, setTargetProgress] = useState(0);
  // 页面展示用的“平滑进度”
  const [displayProgress, setDisplayProgress] = useState(0);

  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // 提交任务（沿用原有接口与逻辑，仅换了 UI）
  const onFinish = async (v: any) => {
    setSubmitting(true);
    setTargetProgress(0);
    setDisplayProgress(0);
    setStatus("QUEUED");
    setDownloadUrl(null);

    try {
      const resp = await fetch(`${API_BASE}/bvh/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: v.text }),
      });
      if (!resp.ok) {
        throw new Error(await resp.text());
      }
      const data = await resp.json();
      const id = data.job_id as string;
      setJobId(id);
      message.success(`已创建任务：${id}`);

      // 打开 WebSocket
      wsRef.current?.close();
      const ws = new WebSocket(`${API_BASE.replace("http", "ws")}/ws/jobs/${id}`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (typeof msg.progress === "number") {
            setTargetProgress(Math.max(0, Math.min(100, msg.progress)));
          }
          if (msg.status) {
            setStatus(msg.status as JobStatus);
          }
          if (msg.download_url) {
            setDownloadUrl(`${API_BASE}${msg.download_url}`);
          }
        } catch {
          // ignore
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

  // 平滑动画：在后端推送之间，displayProgress 以小步向 targetProgress 接近
  useEffect(() => {
    if (status === "COMPLETED") {
      setDisplayProgress(100);
      return;
    }
    if (status === "IDLE") return;

    const timer = setInterval(() => {
      setDisplayProgress((cur) => {
        // 目标值
        const tgt = targetProgress;

        // 若“运行中”且目标没变，轻微自增，避免看起来停住
        let aim = tgt;
        if ((status === "RUNNING" || status === "QUEUED") && cur >= tgt - 0.1 && cur < 99) {
          aim = Math.min(99, cur + 0.2);
        }

        // 朝目标做一次“缓动” —— 每次前进差值的 15%，至少 0.5
        const diff = aim - cur;
        if (Math.abs(diff) < 0.2) return aim; // 足够接近就直接对齐
        const step = Math.max(0.5, diff * 0.15);
        const next = cur + step;

        // 边界与收敛
        return Math.max(0, Math.min(100, next));
      });
    }, 120);

    return () => clearInterval(timer);
  }, [targetProgress, status]);

  // 关闭 WS
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const StatusTag = (
    <Tag color={
      status === "COMPLETED" ? "green" :
      status === "FAILED" ? "red" :
      status === "RUNNING" ? "blue" :
      status === "QUEUED" ? "gold" :
      "default"
    }>
      {status}
    </Tag>
  );

  return (
    <Card title="文本 → BVH" style={{ maxWidth: 720 }}>
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="text" label="文本" rules={[{ required: true, message: "请输入文本" }]}>
          <Input.TextArea rows={6} placeholder="在此输入动作描述…" />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit" loading={submitting}
                  disabled={status === "RUNNING" || status === "QUEUED"}>
            提交任务
          </Button>
          {StatusTag}
        </Space>
      </Form>

      {status !== "IDLE" && (
        <div style={{ marginTop: 24 }}>
          <div style={{ marginBottom: 8 }}>
            进度：{Math.round(displayProgress)}%
          </div>
          <Progress
            percent={Math.round(displayProgress)}
            status={status === "FAILED" ? "exception" : "active"}  // active => 带动效的进度条
            showInfo={false}
          />

          {status === "COMPLETED" && downloadUrl && (
            <div style={{ marginTop: 16 }}>
              {/* download 属性 => 强制下载而不是浏览器预览 */}
              <Button type="link">
                <a href={downloadUrl} download>下载 BVH 文件</a>
              </Button>
            </div>
          )}

          {status === "FAILED" && (
            <div style={{ marginTop: 12, color: "#d4380d" }}>
              任务失败
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
