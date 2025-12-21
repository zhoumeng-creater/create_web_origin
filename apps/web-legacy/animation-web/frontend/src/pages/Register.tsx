import { Card, Form, Input, Button, message, Typography } from "antd";
import { api } from "../lib/api";
import { Link, useNavigate } from "react-router-dom";

const pwdRule = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/; // 前端可用前瞻

export default function Register() {
  const [form] = Form.useForm();
  const nav = useNavigate();

  async function onFinish(v: any) {
    try {
      await api.post("/auth/register", v);
      message.success("注册成功，请登录");
      nav("/login");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "注册失败");
    }
  }

  return (
    <Card title="注册" style={{ maxWidth: 420, margin: "40px auto" }}>
      <Form layout="vertical" form={form} onFinish={onFinish}>
        <Form.Item name="email" label="邮箱" rules={[{ required: true }, { type: "email" }]}>
          <Input placeholder="you@example.com" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={[
            { required: true, message: "请输入密码" },
            { pattern: pwdRule, message: "至少6位，且必须同时包含字母与数字" },
          ]}
          hasFeedback
        >
          <Input.Password />
        </Form.Item>
        <Button type="primary" htmlType="submit" block>注册</Button>
      </Form>
      <Typography.Paragraph style={{ marginTop: 12 }}>
        已有账号？<Link to="/login">去登录</Link>
      </Typography.Paragraph>
    </Card>
  );
}
