// src/pages/Jobs.tsx
import { useEffect, useState } from "react";
import { Card, Form, Input, Button, Progress, Tag } from "antd";

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export default function Jobs() {
  const [form] = Form.useForm();
  const [jobId, setJobId] = useState<string>();
  const [state, setState] = useState<{ status: string; progress: number; asset_id?: string }>();

  async function onSubmit(v: any) {
    const res = await fetch(`${API}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "mp4", text: v.text }),
    });
    const { job_id } = await res.json();
    setJobId(job_id);

    // WebSocket 订阅进度
    const ws = new WebSocket(`${API.replace(/^http/, "ws")}/ws/jobs/${job_id}`);
    ws.onmessage = (e) => setState(JSON.parse(e.data));
  }

  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      const d = await (await fetch(`${API}/jobs/${jobId}`)).json();
      setState(d);
      if (["COMPLETED", "FAILED", "CANCELED", "NOT_FOUND"].includes(d.status)) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [jobId]);

  return (
    <div style={{ maxWidth: 680, margin: "40px auto" }}>
      <Card title="提交任务 → 查看进度">
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="text" label="文本描述" rules={[{ required: true }]}>
            <Input.TextArea rows={4} placeholder="demo text..." />
          </Form.Item>
          <Button type="primary" htmlType="submit">提交任务</Button>
        </Form>
      </Card>

      {state && (
        <Card style={{ marginTop: 16 }} title={`Job ${jobId}`}>
          <Tag color={state.status === "COMPLETED" ? "green" : state.status === "RUNNING" ? "blue" : "default"}>
            {state.status}
          </Tag>
          <Progress percent={state.progress} />
          {state.asset_id && <div>asset_id: {state.asset_id}</div>}
        </Card>
      )}
    </div>
  );
}
