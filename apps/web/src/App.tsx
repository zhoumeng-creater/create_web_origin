import { Route, Routes, useParams } from "react-router-dom";

import { CreatePage } from "./pages/CreatePage";
import { DetailPage } from "./pages/DetailPage";
import { LibraryPage } from "./pages/LibraryPage";
import { AppLayout } from "./components/layout/AppLayout";

const WorkDetailRoute = () => {
  const { id } = useParams();
  return <DetailPage jobId={id} />;
};

export const App = () => (
  <Routes>
    <Route element={<AppLayout />}>
      <Route path="/" element={<CreatePage />} />
      <Route path="/works" element={<LibraryPage />} />
      <Route path="/works/:id" element={<WorkDetailRoute />} />
      <Route path="*" element={<CreatePage />} />
    </Route>
  </Routes>
);
