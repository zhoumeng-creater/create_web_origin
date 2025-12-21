import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "./components/layout/AppLayout";
import { CreatePage } from "./pages/CreatePage";
import { LibraryPage } from "./pages/LibraryPage";
import { WorkDetailPage } from "./pages/WorkDetailPage";

export const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<CreatePage />} />
          <Route path="works" element={<LibraryPage />} />
          <Route path="works/:id" element={<WorkDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
