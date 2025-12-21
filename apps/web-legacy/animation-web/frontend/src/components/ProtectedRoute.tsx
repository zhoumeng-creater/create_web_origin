import { useEffect, useState, type ReactNode } from "react";
import { fetchMe, getToken } from "../store/auth";
import { Spin } from "antd";
import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!getToken()) {
        if (active) setOk(false);
        return;
      }
      const me = await fetchMe();
      if (active) setOk(!!me);
    };

    void run().catch((e) => {
      console.error(e);
      if (active) setOk(false);
    });

    return () => {
      active = false;
    };
  }, []);

  if (ok === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginTop: 80 }}>
        <Spin />
      </div>
    );
  }
  return ok ? <>{children}</> : <Navigate to="/login" replace />;
}
