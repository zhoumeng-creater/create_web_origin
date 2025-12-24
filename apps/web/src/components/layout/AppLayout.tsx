import { Outlet } from "react-router-dom";

import { AppSidebar } from "../sidebar/AppSidebar";
import "./layout.css";

export const AppLayout = () => (
  <div className="app-shell">
    <AppSidebar />
    <div className="app-main">
      <Outlet />
    </div>
  </div>
);
