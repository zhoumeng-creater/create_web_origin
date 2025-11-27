// src/pages/GenerateMusic.tsx
import { useEffect, useRef, useState } from "react";
import { Card, Form, Input, Button, message, Progress, Space, Typography } from "antd";
import { API_BASE } from "../lib/api";   // ★ 新增：统一后端前缀

type MusicStatus =
  | { status: "idle"; progress: number }
  | { status: "pending" | "running"; progress: number }
  | { status: "done"; progress: number; audio_url: string }
  | { status: "error"; progress: number; error: string };

const { Text, Paragraph } = Typography;

// ★ 用 API_BASE 拼出完整后端地址
const MUSIC_BACKEND = `${API_BASE}/music`;
// ★ 音频静态目录也带上同样前缀
const MUSICDATA_PREFIX = `${API_BASE}/musicdata`;

const withCacheBuster = (u: string) => `${u}${u.includes("?") ? "&" : "?"}t=${Date.now()}`;

export default function GenerateMusic() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<MusicStatus>({ status: "idle", progress: 0 });
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const pollTimer = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const clearPoll = () => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };
  useEffect(() => () => clearPoll(), []);

  const startPolling = (jid: string) => {
    clearPoll();
    setStatus({ status: "running", progress: 1 });

    pollTimer.current = window.setInterval(async () => {
      try {
        const r = await fetch(`${MUSIC_BACKEND}/status/${jid}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const s = await r.json();

        if (s.status === "FAILED") {
          clearPoll();
          setStatus({ status: "error", progress: 0, error: s.error || "生成失败" });
          setLoading(false);
          return;
        }

        const prog = Math.max(1, Math.min(99, Number(s.progress ?? 0)));
        setStatus({ status: "running", progress: prog });

        if (s.status === "COMPLETED") {
          clearPoll();
          const raw = `${MUSICDATA_PREFIX}/${jid}.wav`;
          const fresh = withCacheBuster(raw);
          setAudioUrl(fresh);
          setStatus({ status: "done", progress: 100, audio_url: fresh });
          setLoading(false);
          requestAnimationFrame(() => audioRef.current?.load());
        }
      } catch (e: any) {
        clearPoll();
        setStatus({ status: "error", progress: 0, error: e?.message || "轮询失败" });
        setLoading(false);
      }
    }, 800);
  };

  const onGenerate = async (values: any) => {
    const prompt: string = (values.text || "").trim();
    if (!prompt) return message.warning("请输入要生成的音乐描述");

    setLoading(true);
    setAudioUrl(null);
    setJobId(null);
    setStatus({ status: "pending", progress: 0 });

    try {
      const resp = await fetch(`${MUSIC_BACKEND}/generate_async`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      const data: { job_id: string } = await resp.json();
      if (!data?.job_id) throw new Error("没有返回 job_id");
      setJobId(data.job_id);
      startPolling(data.job_id);
    } catch (e: any) {
      setStatus({ status: "error", progress: 0, error: e?.message || "创建失败" });
      setLoading(false);
    }
  };

  const onCancel = () => {
    clearPoll();
    setLoading(false);
    setAudioUrl(null);
    setStatus({ status: "idle", progress: 0 });
    message.info("已取消");
  };

  const guessFilename = () => {
    if (!audioUrl) return "musicgpt-audio.wav";
    try {
      const u = new URL(audioUrl, window.location.origin);
      const last = u.pathname.split("/").pop() || "musicgpt-audio.wav";
      return decodeURIComponent(last);
    } catch {
      const last = audioUrl.split("/").pop() || "musicgpt-audio.wav";
      return decodeURIComponent(last);
    }
  };

  return (
    <Card title="文本 → 音乐" style={{ maxWidth: 760 }}>
      <Form form={form} layout="vertical" onFinish={onGenerate}>
        <Form.Item
          label="文本"
          name="text"
          rules={[{ required: true, message: "请输入音乐描述" }]}
          extra="例：生成一段忧伤的钢琴旋律，节奏缓慢、带有呼吸感的和声推进"
        >
          <Input.TextArea rows={6} placeholder="请输入音乐提示词/描述..." />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit" loading={loading} disabled={loading}>
            生成音乐
          </Button>
          <Button onClick={onCancel} disabled={!loading}>
            取 消
          </Button>
        </Space>
      </Form>

      <div style={{ marginTop: 16 }}>
        {(status.status === "pending" || status.status === "running") && (
          <>
            <Progress percent={status.progress} status="active" />
            <Text type="secondary">
              正在生成中，请稍候… {jobId ? `（任务ID：${jobId}）` : ""}
            </Text>
          </>
        )}

        {status.status === "done" && (
          <>
            <Progress percent={status.progress} />
            <Paragraph style={{ marginTop: 8, marginBottom: 8 }}>
              生成完成{jobId ? `，任务ID：${jobId}` : ""}。
            </Paragraph>

            {audioUrl && (
              <div>
                <audio
                  key={audioUrl}
                  ref={audioRef}
                  controls
                  preload="auto"
                  style={{ width: "100%" }}
                  onError={() => message.error("音频加载失败，请刷新后重试")}
                >
                  <source src={audioUrl} type="audio/wav" />
                </audio>

                <Space style={{ marginTop: 10 }}>
                  <Button type="primary" href={audioUrl} download={guessFilename()}>
                    下载音频
                  </Button>
                  <Button href={audioUrl} target="_blank">
                    在新窗口打开
                  </Button>
                </Space>
                <Paragraph copyable style={{ marginTop: 8 }}>
                  音频地址：{audioUrl}
                </Paragraph>
              </div>
            )}
          </>
        )}

        {status.status === "error" && (
          <>
            <Progress percent={status.progress} status="exception" />
            <Text type="danger">生成失败：{status.error}</Text>
          </>
        )}
      </div>
    </Card>
  );
}
