import { z } from "zod";

export const assetRefSchema = z
  .object({
    uri: z.string().optional(),
    mime: z.string().optional(),
    id: z.string().optional(),
    sha256: z.string().optional(),
    bytes: z.number().optional(),
    meta: z.unknown().optional(),
  })
  .strip();

export type AssetRef = z.infer<typeof assetRefSchema>;

export const manifestInputsSchema = z
  .object({
    raw_prompt: z.string().optional(),
    style: z.string().optional(),
    duration_s: z.number().optional(),
  })
  .catchall(z.unknown());

export type ManifestInputs = z.infer<typeof manifestInputsSchema>;

export const manifestOutputsSchema = z
  .object({
    scene: z
      .object({
        panorama: assetRefSchema.optional(),
      })
      .optional(),
    motion: z
      .object({
        bvh: assetRefSchema.optional(),
        fps: z.number().optional(),
        duration_s: z.number().optional(),
      })
      .optional(),
    music: z
      .object({
        wav: assetRefSchema.optional(),
        duration_s: z.number().optional(),
      })
      .optional(),
    preview: z
      .object({
        config: assetRefSchema.optional(),
      })
      .optional(),
    export: z
      .object({
        mp4: assetRefSchema.nullable().optional(),
        zip: assetRefSchema.nullable().optional(),
      })
      .optional(),
  })
  .strip();

export type ManifestOutputs = z.infer<typeof manifestOutputsSchema>;

export const manifestSchema = z
  .object({
    job_id: z.string(),
    uir_version: z.string().optional(),
    created_at: z.string().optional(),
    status: z.string().optional(),
    inputs: manifestInputsSchema.optional(),
    outputs: manifestOutputsSchema.optional(),
    errors: z.array(z.unknown()).optional(),
  })
  .strip();

export type Manifest = z.infer<typeof manifestSchema>;

export const parseManifest = (value: unknown): Manifest => manifestSchema.parse(value);

export const isManifest = (value: unknown): value is Manifest =>
  manifestSchema.safeParse(value).success;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pickString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
};

const pickRecord = (...values: unknown[]): Record<string, unknown> | undefined => {
  for (const value of values) {
    if (isRecord(value)) {
      return value;
    }
  }
  return undefined;
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const getPath = (source: unknown, path: string[]): unknown => {
  let current: unknown = source;
  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
};

const getAny = (source: unknown, paths: string[][]): unknown => {
  for (const path of paths) {
    const value = getPath(source, path);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

const normalizeAssetRef = (value: unknown): AssetRef | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return { uri: value };
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const uri = pickString(value.uri, value.path, value.url);
  const payload: AssetRef = {};
  if (uri) {
    payload.uri = uri;
  }
  if (typeof value.mime === "string") {
    payload.mime = value.mime;
  }
  if (typeof value.id === "string") {
    payload.id = value.id;
  }
  if (typeof value.sha256 === "string") {
    payload.sha256 = value.sha256;
  }
  if (typeof value.bytes === "number") {
    payload.bytes = value.bytes;
  }
  if (value.meta !== undefined) {
    payload.meta = value.meta;
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
};

const normalizeOutputs = (source: Record<string, unknown>): Manifest["outputs"] => {
  const outputs: Manifest["outputs"] = {};

  const panorama = normalizeAssetRef(
    getAny(source, [
      ["outputs", "scene", "panorama"],
      ["outputs", "scene", "panorama_png"],
      ["outputs", "scene", "panorama_uri"],
      ["outputs", "scene", "panorama_url"],
      ["outputs", "panorama_png"],
      ["outputs", "panorama_url"],
      ["panorama_png"],
      ["panorama_url"],
      ["panorama_uri"],
      ["outputs", "scene_panorama"],
      ["scene", "panorama"],
      ["scene", "panorama_png"],
      ["scene", "panorama_url"],
      ["scene_panorama"],
    ])
  );
  if (panorama) {
    outputs.scene = { panorama };
  }

  const motionBvh = normalizeAssetRef(
    getAny(source, [
      ["outputs", "motion", "bvh"],
      ["outputs", "motion", "bvh_uri"],
      ["outputs", "motion", "bvh_url"],
      ["outputs", "motion", "bvh_path"],
      ["outputs", "bvh_download_url"],
      ["outputs", "motion_bvh"],
      ["bvh_download_url"],
      ["download_url"],
      ["bvh_url"],
      ["bvh_uri"],
      ["bvh"],
      ["motion", "bvh"],
      ["motion", "bvh_uri"],
      ["motion_bvh"],
    ])
  );
  const motionFps = toNumber(
    getAny(source, [
      ["outputs", "motion", "fps"],
      ["outputs", "motion_fps"],
      ["motion", "fps"],
    ])
  );
  const motionDuration = toNumber(
    getAny(source, [
      ["outputs", "motion", "duration_s"],
      ["outputs", "motion", "duration"],
      ["outputs", "motion_duration_s"],
      ["motion", "duration_s"],
      ["motion_duration_s"],
    ])
  );
  if (motionBvh || motionFps !== undefined || motionDuration !== undefined) {
    outputs.motion = {
      ...(motionBvh ? { bvh: motionBvh } : {}),
      ...(motionFps !== undefined ? { fps: motionFps } : {}),
      ...(motionDuration !== undefined ? { duration_s: motionDuration } : {}),
    };
  }

  const musicWav = normalizeAssetRef(
    getAny(source, [
      ["outputs", "music", "wav"],
      ["outputs", "music", "wav_uri"],
      ["outputs", "music", "wav_url"],
      ["outputs", "music", "wav_path"],
      ["outputs", "audio_url"],
      ["outputs", "music_wav"],
      ["audio_url"],
      ["wav_url"],
      ["wav_uri"],
      ["wav"],
      ["music", "wav"],
      ["music", "wav_uri"],
      ["music_wav"],
    ])
  );
  const musicDuration = toNumber(
    getAny(source, [
      ["outputs", "music", "duration_s"],
      ["outputs", "music", "duration"],
      ["outputs", "music_duration_s"],
      ["music", "duration_s"],
      ["music_duration_s"],
    ])
  );
  if (musicWav || musicDuration !== undefined) {
    outputs.music = {
      ...(musicWav ? { wav: musicWav } : {}),
      ...(musicDuration !== undefined ? { duration_s: musicDuration } : {}),
    };
  }

  const previewConfig = normalizeAssetRef(
    getAny(source, [
      ["outputs", "preview", "config"],
      ["outputs", "preview", "preview_config"],
      ["outputs", "preview_config"],
      ["outputs", "preview_config_uri"],
      ["preview", "config"],
      ["preview_config"],
      ["preview_config_uri"],
    ])
  );
  if (previewConfig) {
    outputs.preview = { config: previewConfig };
  }

  const rawExportMp4 = getAny(source, [
    ["outputs", "export", "mp4"],
    ["outputs", "export_mp4"],
    ["outputs", "preview_url"],
    ["outputs", "mp4_url"],
    ["outputs", "mp4_list", "0"],
    ["preview_url"],
    ["mp4_url"],
    ["mp4_list", "0"],
    ["export", "mp4"],
    ["export_mp4"],
  ]);
  const rawExportZip = getAny(source, [
    ["outputs", "export", "zip"],
    ["outputs", "export_zip"],
    ["outputs", "zip_url"],
    ["outputs", "bundle_url"],
    ["zip_url"],
    ["bundle_url"],
    ["export", "zip"],
    ["export_zip"],
  ]);
  const exportMp4 = rawExportMp4 === null ? null : normalizeAssetRef(rawExportMp4);
  const exportZip = rawExportZip === null ? null : normalizeAssetRef(rawExportZip);
  if (exportMp4 !== undefined || exportZip !== undefined) {
    outputs.export = {
      ...(exportMp4 !== undefined ? { mp4: exportMp4 } : {}),
      ...(exportZip !== undefined ? { zip: exportZip } : {}),
    };
  }

  return Object.keys(outputs).length > 0 ? outputs : undefined;
};

export const normalizeManifest = (raw: unknown): Manifest => {
  const source = isRecord(raw) ? raw : {};
  const normalized: Manifest = {
    job_id: pickString(source.job_id, source.jobId, source.id) ?? "",
    uir_version: pickString(source.uir_version, source.uirVersion),
    created_at: pickString(source.created_at, source.createdAt),
    status: pickString(source.status),
    inputs: pickRecord(source.inputs, source.input, source.intent),
    outputs: normalizeOutputs(source),
    errors: Array.isArray(source.errors) ? source.errors : undefined,
  };
  return manifestSchema.parse(normalized);
};
