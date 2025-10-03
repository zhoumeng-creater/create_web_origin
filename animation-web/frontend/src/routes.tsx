// src/routes.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import GenerateMp4 from "./pages/GenerateMp4";
import GenerateBvh from "./pages/GenerateBvh";
import Jobs from "./pages/Jobs";
import Assets from "./pages/Assets";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";

export default function AppRoutes() {
  return (
    <Routes>
      {/* 公共路由 */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* 受保护路由 */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout><Dashboard /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Layout><Dashboard /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/generate/mp4"
        element={
          <ProtectedRoute>
            <Layout><GenerateMp4 /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/generate/bvh"
        element={
          <ProtectedRoute>
            <Layout><GenerateBvh /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/jobs"
        element={
          <ProtectedRoute>
            <Layout><Jobs /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/assets"
        element={
          <ProtectedRoute>
            <Layout><Assets /></Layout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
