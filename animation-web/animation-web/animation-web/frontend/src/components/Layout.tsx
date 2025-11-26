import { Layout, Menu, Button } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { clearToken } from "../store/auth";

const { Header, Sider, Content } = Layout;
const items = [
  { key: "/dashboard", label: <Link to="/dashboard">Dashboard</Link> },
  { key: "/generate/mp4", label: <Link to="/generate/mp4">文本→MP4</Link> },
  { key: "/generate/bvh", label: <Link to="/generate/bvh">文本→BVH</Link> },
  { key: "/jobs", label: <Link to="/jobs">任务中心</Link> },
  { key: "/assets", label: <Link to="/assets">我的资产</Link> },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  return (
    <>
      <Header style={{ color: "#fff", fontWeight: 600, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span>AnimationGPT Studio</span>
        <Button onClick={()=>{ clearToken(); nav("/login"); }}>退出登录</Button>
      </Header>
      <Layout>
        <Sider width={220}>
          <Menu theme="dark" mode="inline" selectedKeys={[loc.pathname]} items={items} />
        </Sider>
        <Content style={{ padding: 24 }}>{children}</Content>
      </Layout>
    </>
  );
}
