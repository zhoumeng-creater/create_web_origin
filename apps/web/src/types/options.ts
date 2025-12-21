export type CreateJobOptions = {
  targets?: string[];
  duration_s?: number;
  style?: string;
  mood?: string;
  export_video?: boolean;
  [key: string]: unknown;
};
