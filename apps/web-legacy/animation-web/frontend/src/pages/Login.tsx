import { Card, Form, Input, Button, message } from "antd";
import { useNavigate, Link } from "react-router-dom";
import { API_BASE } from "../lib/api";
import { setToken } from "../store/auth";

export default function Login() {
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const onFinish = async (values: any) => {
    // 清掉上次字段错误
    form.setFields([
      { name: "email", errors: [] },
      { name: "password", errors: [] },
    ]);

    try {
      const body = new URLSearchParams();
      body.append("username", values.email);   // 注意后端要的字段名是 username
      body.append("password", values.password);

      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // 精确处理 404 / 401
        if (res.status === 404 && data?.detail === "account_not_found") {
          form.setFields([{ name: "email", errors: ["该账户不存在"] }]);
        } else if (res.status === 401 && data?.detail === "wrong_password") {
          form.setFields([{ name: "password", errors: ["密码输入错误"] }]);
        } else {
          // 兜底（例如后端还是 400 或其它）
          message.error(data?.detail || "登录失败");
        }
        return;
      }

      // 成功
      setToken(data.access_token);
      message.success("登录成功");
      navigate("/dashboard", { replace: true });
    } catch (e) {
      console.error(e);
      message.error("网络错误，请稍后重试");
    }
  };

  return (
    <Card title="登录" style={{ maxWidth: 420, margin: "40px auto" }}>
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="email" label="邮箱" rules={[{ required: true, message: "请输入邮箱" }]}>
          <Input placeholder="you@example.com" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
          <Input.Password placeholder="至少6位，包含字母和数字" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block>
          登 录
        </Button>
        <div style={{ marginTop: 12 }}>
          还没有账号？<Link to="/register">去注册</Link>
        </div>
      </Form>
    </Card>
  );
}
