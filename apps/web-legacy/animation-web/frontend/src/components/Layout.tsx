// src/components/Layout.tsx
import { Layout, Menu } from "antd";
import { Link, useLocation } from "react-router-dom";

const { Header, Sider, Content } = Layout;

const items = [
  { key: "/dashboard", label: <Link to="/dashboard">Dashboard</Link> },
  { key: "/generate/mp4", label: <Link to="/generate/mp4">文本→MP4</Link> },
  { key: "/generate/music", label: <Link to="/generate/music">文本→Music</Link> }, 
  { key: "/generate/bvh", label: <Link to="/generate/bvh">文本→BVH</Link> },
  { key: "/generate/multi", label: <Link to="/generate/multi">多模态动画生成</Link> },
  { key: "/assets", label: <Link to="/assets">我的资产</Link> },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  return (
    <>
      <Header
        style={{
          color: "#fff",
          fontWeight: 600,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>AnimationGPT Studio</span>
        <span />
      </Header>
      <Layout>
        <Sider width={220}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[loc.pathname]}
            items={items}
          />
        </Sider>
        <Content style={{ padding: 24 }}>{children}</Content>
      </Layout>
    </>
  );
}
