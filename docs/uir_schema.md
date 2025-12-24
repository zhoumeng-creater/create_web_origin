# UIR v1 schema (Orchestrator)

This document matches `services/orchestrator/src/uir/models.py` (UIR v1).

## 1. Top-level object

Required fields:
- `uir_version`: string, must be `"1.0"`
- `job`: object
- `input`: object
- `intent`: object
- `modules`: object

Optional fields:
- `routing`: object
- `constraints`: object
- `runtime`: object
- `hooks`: object

## 2. Objects

### 2.1 job
- `id`: string, required
- `created_at`: string (ISO 8601), required
- `title`: string, optional
- `client`: object, optional
- `tags`: string[], optional
- `parent_job_id`: string, optional

### 2.2 input
- `raw_prompt`: string, required
- `lang`: string, optional
- `references`: `AssetRef[]`, optional
- `ui_choices`: object, optional

`AssetRef` fields:
- `id`: string
- `role`: string
- `mime`: string
- `uri`: string
- `sha256`: string, optional
- `bytes`: number, optional
- `meta`: object, optional

### 2.3 intent
- `targets`: string[], required
- `duration_s`: number, default `12`
- `style`: string, optional
- `mood`: string, optional
- `storybeat`: string, optional
- `language_policy`: object, optional

Rule: any enabled module must be listed in `intent.targets`.

### 2.4 routing
Per-module provider overrides:
- `scene` / `motion` / `music` / `character` / `preview` / `export`
- each value is `{ "provider": "<provider_id>" }`

### 2.5 modules

`scene`:
- `enabled`: boolean
- `prompt`: string, required when `enabled=true`
- `negative_prompt`: string, optional
- `resolution`: `[width, height]`, default `[2048, 1024]`
- `seed`: integer, optional
- `steps`: integer, optional
- `cfg_scale`: number, optional
- `upscale`: boolean, optional

Note: `scene.resolution` must satisfy `width == height * 2`.

`motion`:
- `enabled`: boolean
- `prompt`: string, required when `enabled=true`
- `duration_s`: number, optional
- `fps`: integer (15-60), default `30`
- `style`: string, optional
- `action_params`: object, optional
- `postprocess`: object, optional

`music`:
- `enabled`: boolean
- `prompt`: string, required when `enabled=true`
- `duration_s`: number, optional
- `tempo_bpm`: number, optional
- `genre`: string, optional

`character`:
- `enabled`: boolean
- `character_id`: string, optional
- `style`: string, optional
- `retarget`: object, optional

`preview`:
- `enabled`: boolean
- `camera_preset`: string, optional
- `autoplay`: boolean, optional
- `timeline`: object, optional

`export`:
- `enabled`: boolean
- `format`: string (`"mp4"` or `"zip"`), optional
- `resolution`: `[width, height]`, optional
- `fps`: integer, optional
- `bitrate`: string, optional
- `include`: string[], optional

### 2.6 constraints / runtime / hooks

`constraints`:
- `max_runtime_s`: number, optional
- `quality`: string, optional
- `safety`: object, optional

`runtime`:
- `priority`: number, optional
- `concurrency_key`: string, optional
- `locks`: object, optional
- `fallback`: object, optional
- `cache_policy`: object, optional

`hooks`:
- `event_stream`: boolean, optional

## 3. Defaults and validation
- `intent.duration_s` defaults to `12`.
- `motion.fps` defaults to `30`.
- Modules default to `enabled=false` unless explicitly set.
- `intent.targets` must include every enabled module.

## 4. Rule-based prompt -> UIR mapping

Given front-end payload:

```json
{
  "prompt": "...",
  "options": {
    "duration_s": 12,
    "style": "cinematic",
    "mood": "epic",
    "export_video": true,
    "export_preset": "mp4_1080p",
    "advanced": {
      "seed": 42,
      "resolution": [2048, 1024]
    }
  }
}
```

Mapping:
- `input.raw_prompt` <- `prompt`
- `intent.duration_s` <- `options.duration_s`
- `intent.style` <- `options.style`
- `intent.mood` <- `options.mood`
- `modules.scene.prompt` <- `prompt` (rule-based)
- `modules.motion.prompt` <- `prompt` (rule-based)
- `modules.music.prompt` <- `prompt` (rule-based)
- `modules.scene.seed` <- `options.advanced.seed`
- `modules.scene.resolution` <- `options.advanced.resolution` (coerced to 2:1)
- `modules.export.*` <- `options.export_preset` (format/resolution)
- `intent.targets` aligns with `modules.*.enabled`

## 5. Example (UIR v1)

```json
{
  "uir_version": "1.0",
  "job": {
    "id": "job_123",
    "created_at": "2025-12-24T12:00:00Z"
  },
  "input": {
    "raw_prompt": "A warrior dashes forward with epic music",
    "lang": "en"
  },
  "intent": {
    "targets": ["scene", "motion", "music", "preview", "export"],
    "duration_s": 12,
    "style": "cinematic",
    "mood": "epic"
  },
  "routing": {
    "scene": { "provider": "diffusion360_local" },
    "motion": { "provider": "animationgpt_local" },
    "music": { "provider": "musicgpt_cli" },
    "preview": { "provider": "web_threejs" },
    "export": { "provider": "ffmpeg_export" }
  },
  "modules": {
    "scene": {
      "enabled": true,
      "prompt": "A cinematic 360 panorama",
      "resolution": [2048, 1024]
    },
    "motion": {
      "enabled": true,
      "prompt": "A warrior dashes forward",
      "fps": 30,
      "duration_s": 12
    },
    "music": {
      "enabled": true,
      "prompt": "Epic orchestral music",
      "duration_s": 12
    },
    "character": { "enabled": false },
    "preview": { "enabled": true },
    "export": {
      "enabled": true,
      "format": "mp4",
      "resolution": [1920, 1080]
    }
  }
}
```
