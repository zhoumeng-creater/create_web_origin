import { z } from "zod";

export const previewConfigSchema = z
  .object({
    scene: z
      .object({
        panorama_uri: z.string().optional(),
      })
      .optional(),
    character: z
      .object({
        model_uri: z.string().optional(),
        skeleton: z.string().optional(),
      })
      .optional(),
    motion: z.object({
      bvh_uri: z.string(),
      fps: z.number().optional(),
    }),
    music: z
      .object({
        wav_uri: z.string().optional(),
        offset_s: z.number().optional(),
      })
      .optional(),
    camera: z
      .object({
        preset: z.string().optional(),
        auto_rotate: z.boolean().optional(),
      })
      .optional(),
    timeline: z
      .object({
        duration_s: z.number().optional(),
      })
      .optional(),
  })
  .strip();

export type PreviewConfig = z.infer<typeof previewConfigSchema>;

export const parsePreviewConfig = (value: unknown): PreviewConfig =>
  previewConfigSchema.parse(value);

export const isPreviewConfig = (value: unknown): value is PreviewConfig =>
  previewConfigSchema.safeParse(value).success;
