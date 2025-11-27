// src/routes.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import GenerateMp4 from "./pages/GenerateMp4";
import GenerateBvh from "./pages/GenerateBvh";
import GenerateMusic from "./pages/GenerateMusic"; 
import GenerateMultiModal from "./pages/GenerateMultiModal";
import Assets from "./pages/Assets";
import Layout from "./components/Layout";

export default function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Layout>
            <Dashboard />
          </Layout>
        }
      />

      <Route
        path="/dashboard"
        element={
          <Layout>
            <Dashboard />
          </Layout>
        }
      />

      <Route
        path="/generate/music"
        element={
          <Layout>
            <GenerateMusic />
          </Layout>
        }
      />

      <Route
        path="/generate/mp4"
        element={
          <Layout>
            <GenerateMp4 />
          </Layout>
        }
      />

      <Route
        path="/generate/bvh"
        element={
          <Layout>
            <GenerateBvh />
          </Layout>
        }
      />
      
       <Route
        path="/generate/multi"
        element={
          <Layout>
            <GenerateMultiModal />
          </Layout>
        }
      />

      <Route
        path="/assets"
        element={
          <Layout>
            <Assets />
          </Layout>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
