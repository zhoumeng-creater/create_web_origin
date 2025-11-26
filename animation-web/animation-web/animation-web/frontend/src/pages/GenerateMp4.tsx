import { useState } from "react";
import { Card, Form, Input, Button, message } from "antd";
import { api } from "../lib/api";

export default function GenerateMp4() {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const onFinish = async (v: any) => {
    setLoading(true);
    try {
      const { data } = await api.post("/jobs", { type: "mp4", text: v.text });
      message.success(`已创建任务：${data.job_id}`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "创建任务失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="文本 → MP4" style={{ maxWidth: 720 }}>
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="text" label="文本" rules={[{ required: true }]}>
          <Input.TextArea rows={4} placeholder="在此输入场景描述..." />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading}>
          提交任务
        </Button>
      </Form>
    </Card>
  );
}
