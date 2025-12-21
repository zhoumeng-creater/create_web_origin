import { WorkDetailPage } from "./WorkDetailPage";

type DetailPageProps = {
  jobId?: string;
};

export const DetailPage = ({ jobId }: DetailPageProps) => <WorkDetailPage jobId={jobId} />;
