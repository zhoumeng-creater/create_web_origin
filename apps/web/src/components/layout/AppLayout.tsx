import { Outlet } from "react-router-dom";

import { Sidebar } from "./Sidebar";

export const AppLayout = () => {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#ffffff" }}>
      <Sidebar />
      <main style={{ flex: 1, padding: 32 }}>
        <Outlet />
      </main>
    </div>
  );
};
