// src/App.tsx
import AppRouter from "./routes";              // ✅ 这里从 ./router 改成 ./routes
import AiAssistant from "./components/AiAssistant";

export default function App() {
  return (
    <>
      <AppRouter />
      <AiAssistant />                          {/* 浮窗组件，全站可见 */}
    </>
  );
}
