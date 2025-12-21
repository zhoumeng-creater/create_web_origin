# UIR（统一中间表示）规范 v2

## 1. 顶层结构

UIR 顶层对象包含以下字段（snake_case）：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| project | object | 是 | 项目信息 |
| input | object | 是 | 原始输入信息 |
| intent | object | 是 | 生成意图与目标 |
| scene | object | 是 | 场景生成参数 |
| motion | object | 是 | 动作生成参数 |
| music | object | 是 | 音乐生成参数 |
| output | object | 是 | 输出与导出参数 |

## 2. 字段说明

### project

- `title`（string，必填）：项目标题。
- `created_at`（string，必填）：创建时间，ISO 8601（UTC）。

### input

- `raw_prompt`（string，必填）：用户原始提示词。
- `lang`（string，必填）：语言标记（如 `zh-CN`、`en-US`）。

### intent

- `duration_s`（number，必填）：整体时长（秒）。
- `style`（string，必填）：风格。
- `mood`（string，必填）：情绪。
- `targets`（string[]，必填）：生成目标，枚举值：`"scene"` / `"motion"` / `"music"`。

### scene

- `provider`（string，必填）：默认 `"diffusion360"`。
- `prompt`（string，必填）：场景提示词。
- `negative`（string，可选）：场景负向提示词。
- `resolution`（[number, number]，必填）：[width, height] 像素。
- `seed`（integer，可选）：随机种子。
- `steps`（integer，可选）：采样步数。
- `cfg`（number，可选）：CFG scale。

### motion

- `provider`（string，必填）：默认 `"animationgpt"`。
- `prompt`（string，必填）：动作提示词。
- `fps`（integer，必填）：帧率。
- `length_s`（number，必填）：动作时长（秒）。
- `seed`（integer，可选）：随机种子。

### music

- `provider`（string，必填）：默认 `"musicgpt"`。
- `prompt`（string，必填）：音乐提示词。
- `secs`（number，必填）：音乐时长（秒）。
- `bpm`（number，可选）：节拍。
- `seed`（integer，可选）：随机种子。

### output

- `need_preview`（boolean，必填）：是否生成预览。
- `need_export_video`（boolean，必填）：是否导出视频。
- `export_preset`（string，必填）：导出预设标识（如 `mp4_1080p`）。

## 3. 默认值策略

- `intent.duration_s` 默认 `12`。
- `motion.fps` 默认 `30`。
- `intent.targets` 默认 `["scene","motion","music"]`。
- `scene.provider` / `motion.provider` / `music.provider` 默认分别为 `"diffusion360"` / `"animationgpt"` / `"musicgpt"`。
- 默认值在字段缺省时补齐，不覆盖用户显式输入。

## 4. 前端参数面板 -> UIR 字段映射

| 前端控件 | UIR 字段 | 说明 |
| --- | --- | --- |
| 项目标题输入框 | `project.title` |  |
| 创建时间 | `project.created_at` | 通常由前端/后端在创建时写入 |
| 原始提示词输入框 | `input.raw_prompt` |  |
| 语言/语种选择 | `input.lang` |  |
| 生成目标多选 | `intent.targets` | 选择 scene/motion/music |
| 动画时长滑条 | `intent.duration_s` | 同步写入 `motion.length_s` 与 `music.secs` |
| 风格选择 | `intent.style` |  |
| 情绪选择 | `intent.mood` |  |
| 场景提示词 | `scene.prompt` |  |
| 场景负向提示词 | `scene.negative` | 可选开关 |
| 场景分辨率 | `scene.resolution` | [w, h] |
| 场景采样步数 | `scene.steps` | 高级参数 |
| 场景 CFG | `scene.cfg` | 高级参数 |
| 场景随机种子 | `scene.seed` |  |
| 动作提示词 | `motion.prompt` |  |
| 动作帧率 | `motion.fps` |  |
| 动作随机种子 | `motion.seed` |  |
| 音乐提示词 | `music.prompt` |  |
| 音乐 BPM | `music.bpm` |  |
| 音乐随机种子 | `music.seed` |  |
| 预览开关 | `output.need_preview` |  |
| 导出视频开关 | `output.need_export_video` |  |
| 导出预设选择 | `output.export_preset` |  |
| 模型/引擎选择（若有） | `scene.provider` / `motion.provider` / `music.provider` | 默认值见“默认值策略” |

## 5. JSON 示例

```json
{
  "project": {
    "title": "Cyberpunk Dojo",
    "created_at": "2025-12-21T12:00:00Z"
  },
  "input": {
    "raw_prompt": "A cyberpunk dojo in heavy rain, samurai training, epic music",
    "lang": "en-US"
  },
  "intent": {
    "duration_s": 12,
    "style": "Cinematic",
    "mood": "Epic",
    "targets": ["scene", "motion", "music"]
  },
  "scene": {
    "provider": "diffusion360",
    "prompt": "Neon-lit dojo in heavy rain, cinematic lighting",
    "negative": "blurry, low quality",
    "resolution": [1920, 1080],
    "seed": 42,
    "steps": 30,
    "cfg": 7.5
  },
  "motion": {
    "provider": "animationgpt",
    "prompt": "Samurai training kata, sharp and fast movements",
    "fps": 30,
    "length_s": 12,
    "seed": 123
  },
  "music": {
    "provider": "musicgpt",
    "prompt": "Epic orchestral with taiko drums",
    "secs": 12,
    "bpm": 120,
    "seed": 888
  },
  "output": {
    "need_preview": true,
    "need_export_video": true,
    "export_preset": "mp4_1080p"
  }
}
```

## 6. JSON Schema（draft）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/schemas/uir.schema.json",
  "title": "UIR",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "project",
    "input",
    "intent",
    "scene",
    "motion",
    "music",
    "output"
  ],
  "properties": {
    "project": { "$ref": "#/$defs/project" },
    "input": { "$ref": "#/$defs/input" },
    "intent": { "$ref": "#/$defs/intent" },
    "scene": { "$ref": "#/$defs/scene" },
    "motion": { "$ref": "#/$defs/motion" },
    "music": { "$ref": "#/$defs/music" },
    "output": { "$ref": "#/$defs/output" }
  },
  "$defs": {
    "project": {
      "type": "object",
      "additionalProperties": false,
      "required": ["title", "created_at"],
      "properties": {
        "title": { "type": "string", "minLength": 1 },
        "created_at": { "type": "string", "format": "date-time" }
      }
    },
    "input": {
      "type": "object",
      "additionalProperties": false,
      "required": ["raw_prompt", "lang"],
      "properties": {
        "raw_prompt": { "type": "string", "minLength": 1 },
        "lang": { "type": "string", "minLength": 2 }
      }
    },
    "intent": {
      "type": "object",
      "additionalProperties": false,
      "required": ["duration_s", "style", "mood", "targets"],
      "properties": {
        "duration_s": { "type": "number", "minimum": 1, "default": 12 },
        "style": { "type": "string", "minLength": 1 },
        "mood": { "type": "string", "minLength": 1 },
        "targets": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["scene", "motion", "music"]
          },
          "minItems": 1,
          "uniqueItems": true,
          "default": ["scene", "motion", "music"]
        }
      }
    },
    "scene": {
      "type": "object",
      "additionalProperties": false,
      "required": ["provider", "prompt", "resolution"],
      "properties": {
        "provider": { "type": "string", "default": "diffusion360" },
        "prompt": { "type": "string", "minLength": 1 },
        "negative": { "type": "string" },
        "resolution": {
          "type": "array",
          "items": { "type": "integer", "minimum": 1 },
          "minItems": 2,
          "maxItems": 2
        },
        "seed": { "type": "integer", "minimum": 0 },
        "steps": { "type": "integer", "minimum": 1 },
        "cfg": { "type": "number", "minimum": 0 }
      }
    },
    "motion": {
      "type": "object",
      "additionalProperties": false,
      "required": ["provider", "prompt", "fps", "length_s"],
      "properties": {
        "provider": { "type": "string", "default": "animationgpt" },
        "prompt": { "type": "string", "minLength": 1 },
        "fps": { "type": "integer", "minimum": 1, "default": 30 },
        "length_s": { "type": "number", "minimum": 1 },
        "seed": { "type": "integer", "minimum": 0 }
      }
    },
    "music": {
      "type": "object",
      "additionalProperties": false,
      "required": ["provider", "prompt", "secs"],
      "properties": {
        "provider": { "type": "string", "default": "musicgpt" },
        "prompt": { "type": "string", "minLength": 1 },
        "secs": { "type": "number", "minimum": 1 },
        "bpm": { "type": "number", "minimum": 1 },
        "seed": { "type": "integer", "minimum": 0 }
      }
    },
    "output": {
      "type": "object",
      "additionalProperties": false,
      "required": ["need_preview", "need_export_video", "export_preset"],
      "properties": {
        "need_preview": { "type": "boolean" },
        "need_export_video": { "type": "boolean" },
        "export_preset": { "type": "string", "minLength": 1 }
      }
    }
  }
}
```
