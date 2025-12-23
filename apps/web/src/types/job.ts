import { z } from "zod";

export const jobStatusSchema = z.object({
  status: z.string(),
  progress: z.number().optional(),
  stage: z.string().optional(),
  message: z.string().optional(),
  logs_tail: z.array(z.string()).optional(),
  preview_url: z.string().optional(),
  audio_url: z.string().optional(),
  bvh_download_url: z.string().optional(),
  download_url: z.string().optional(),
  mp4_list: z.array(z.string()).optional(),
  zip_url: z.string().optional(),
  partial_assets: z.unknown().optional(),
});

export type JobStatus = z.infer<typeof jobStatusSchema>;

export const parseJobStatus = (value: unknown): JobStatus =>
  jobStatusSchema.parse(value);

export const isJobStatus = (value: unknown): value is JobStatus =>
  jobStatusSchema.safeParse(value).success;

export const jobEventSchema = z.object({
  type: z.enum(["stage", "log", "progress", "done", "error"]),
  data: z.unknown(),
});

export type JobEvent = z.infer<typeof jobEventSchema>;

export const parseJobEvent = (value: unknown): JobEvent =>
  jobEventSchema.parse(value);

export const isJobEvent = (value: unknown): value is JobEvent =>
  jobEventSchema.safeParse(value).success;
