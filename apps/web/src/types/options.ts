export type CreateJobOptions = {
  targets?: string[];
  duration_s?: number;
  style?: string;
  mood?: string;
  export_video?: boolean;
  export_preset?: string;
  advanced?: {
    model?: string;
    seed?: number;
    resolution?: [number, number];
  };
  [key: string]: unknown;
};
