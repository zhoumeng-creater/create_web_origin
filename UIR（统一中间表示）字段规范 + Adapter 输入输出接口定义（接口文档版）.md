# UIR（统一中间表示）字段规范 + Adapter 输入/输出接口定义（接口文档版）

下面是一份**可直接拿去实现**的《UIR（统一中间表示）字段规范 + Adapter 输入/输出接口定义（接口文档版）》草案（建议作为你们仓库 `docs/specs/UIR_and_Adapters_v1.md`）。
它围绕你们现有的“多模型协同 + 任务编排 + Web 展示”的架构思路，把“中继适配器/编排中枢”真正落到**可编码、可校验、可扩展**的接口上。

------

# UIR & Adapters 接口规范（v1）

- 文档版本：v1.0（MVP 可落地）
- 目标：让前端/编排中枢/模型适配器之间只通过**标准 JSON** 交互，支持并发、状态跟踪、后续缓存与模型替换。
- 适用范围（MVP）：
  - 动作：AnimationGPT（本地 Python 脚本调用，输出 BVH）
  - 音乐：MusicGPT.exe（本地 CLI 调用，输出 WAV）
  - 场景：Diffusion360（本地 Python 推理，输出 360 panorama PNG）
  - 预览：Web 端 Three.js 播放（后端只需产出 preview 配置与资源清单）
  - 导出：先提供基础导出适配器接口（可先只导出“资产包”，视频导出后续迭代）

------

## 0. 核心概念与约定

### 0.1 术语

- **UIR（Unified Intent Representation）**：一次“创作请求”在系统内部的统一结构化表达。
- **Job**：一次生成任务实例（UIR 实例 + 执行状态 + 产出资产）。
- **Stage**：任务阶段（规划/生成动作/生成音乐/生成场景/组装预览/导出）。
- **Adapter**：模型或工具的适配器（对外统一接口，对内负责把 UIR 转为模型输入、产出标准化输出）。

### 0.2 版本与兼容

- UIR 必须包含：`uir_version: "1.0"`。
- 后续升级字段只允许**追加**；删除/改语义必须提升主版本。

### 0.3 资源引用（AssetRef）

系统内所有文件产出统一用 `AssetRef` 描述，避免“各模块互相猜路径”。

```json
{
  "id": "asset_xxx",
  "role": "scene_panorama",
  "mime": "image/png",
  "uri": "/assets/<job_id>/scene/panorama.png",
  "sha256": "optional",
  "bytes": 123456,
  "meta": { "width": 2048, "height": 1024 }
}
```

------

## 1. UIR 总体结构（顶层）

### 1.1 顶层 JSON 结构

```json
{
  "uir_version": "1.0",
  "job": { ... },
  "input": { ... },
  "intent": { ... },
  "routing": { ... },
  "modules": {
    "scene": { ... },
    "motion": { ... },
    "music": { ... },
    "character": { ... },
    "preview": { ... },
    "export": { ... }
  },
  "constraints": { ... },
  "runtime": { ... },
  "hooks": { ... }
}
```

> 说明：
>
> - `intent` 是**用户想要的结果**（时长/风格/情绪/产物类型）。
> - `routing` 是**系统决定走哪些模型**（可由 UI 提供偏好，也可由编排中枢自动决定）。
> - `modules.*` 是每一类生成任务的**详细参数**（prompt、分辨率、seed 等）。
> - `runtime` 是执行控制（优先级、并发策略、超时、资源池）。
> - `hooks` 允许未来接入：缓存命中、审核、打分、回调等。

------

## 2. 字段规范（逐字段、类型、约束）

> 标注：
>
> - **R**：Required 必填
> - **O**：Optional 选填
> - 默认值写在字段说明中

### 2.1 `job`（任务元信息）

| 字段              | 类型     | 必填 | 说明                                   |
| ----------------- | -------- | ---- | -------------------------------------- |
| job.id            | string   | R    | 任务唯一 ID（UUID/ULID 均可）          |
| job.created_at    | string   | R    | ISO 时间（UTC 建议）                   |
| job.title         | string   | O    | 作品名；缺省由 prompt 生成摘要         |
| job.client        | object   | O    | 客户端信息：ip/ua/locale（可用于统计） |
| job.tags          | string[] | O    | 标签，如 `["cinematic","dojo"]`        |
| job.parent_job_id | string   | O    | 复用/再生成链路（用于作品版本）        |

------

### 2.2 `input`（原始输入与语言）

| 字段             | 类型       | 必填 | 说明                                                |
| ---------------- | ---------- | ---- | --------------------------------------------------- |
| input.raw_prompt | string     | R    | 用户原始输入（允许中文）                            |
| input.lang       | string     | O    | `zh`/`en`… 未填则由系统检测                         |
| input.references | AssetRef[] | O    | 参考图/参考音（MVP 可留空）                         |
| input.ui_choices | object     | O    | UI 侧选择：风格卡、时长 slider 等（用于重现与复盘） |

建议 `ui_choices` 结构（示例）：

```json
{
  "style_card": "cinematic",
  "mood_card": "epic",
  "duration_s": 12,
  "quality": "standard"
}
```

------

### 2.3 `intent`（用户意图的标准化表达）

| 字段                   | 类型     | 必填 | 说明                                                      |
| ---------------------- | -------- | ---- | --------------------------------------------------------- |
| intent.targets         | string[] | R    | 产物类型：`["scene","motion","music","preview","export"]` |
| intent.duration_s      | number   | R    | 时长（秒），统一时长源（用于动作/音乐/导出同步）          |
| intent.style           | string   | O    | 风格：`cinematic/anime/lowpoly/realistic/...`             |
| intent.mood            | string   | O    | 情绪：`epic/calm/horror/...`                              |
| intent.storybeat       | string   | O    | 简短剧情节拍（用于 Planner 拆分更稳）                     |
| intent.language_policy | object   | O    | 是否允许自动翻译、优先语言等                              |

建议 `language_policy`：

```json
{ "auto_translate_to_en": true, "preserve_original": true }
```

------

### 2.4 `routing`（模型路由/提供方选择）

| 字段                       | 类型   | 必填 | 说明                                                      |
| -------------------------- | ------ | ---- | --------------------------------------------------------- |
| routing.scene.provider     | string | O    | `diffusion360_local` / `blockade_api` / `panfusion_local` |
| routing.motion.provider    | string | O    | `animationgpt_local` / `mdm_local`（预留）                |
| routing.music.provider     | string | O    | `musicgpt_cli` / `musicgen_local`（预留）                 |
| routing.character.provider | string | O    | `builtin_library` / `mixamo_api`（预留）                  |
| routing.preview.provider   | string | O    | `web_threejs` / `server_render`（预留）                   |
| routing.export.provider    | string | O    | `ffmpeg_export` / `blender_export`（预留）                |

> 约束：
>
> - routing 允许为空：由编排中枢按配置默认路由。
> - 一旦写入 routing，Adapter 必须可用，否则进入 fallback（见 `runtime.fallback`）。

------

### 2.5 `modules.scene`（场景模块）

MVP：生成 360 全景图（equirectangular panorama），后续可扩展 cubemap、深度图等。

| 字段                          | 类型             | 必填 | 说明                                             |
| ----------------------------- | ---------------- | ---- | ------------------------------------------------ |
| modules.scene.enabled         | boolean          | R    | 是否启用（由 intent.targets 决定，但这里可显式） |
| modules.scene.prompt          | string           | R*   | 场景 prompt（若 enabled=true 则必填）            |
| modules.scene.negative_prompt | string           | O    | 负面词（默认给一套通用）                         |
| modules.scene.resolution      | [number, number] | O    | `[width,height]` 默认 `[2048,1024]`              |
| modules.scene.seed            | number           | O    | 可复现；未填则随机                               |
| modules.scene.steps           | number           | O    | 推理步数（默认 30）                              |
| modules.scene.cfg_scale       | number           | O    | 引导强度（默认 7.0）                             |
| modules.scene.upscale         | boolean          | O    | 是否超分（默认 false）                           |
| modules.scene.output          | object           | O    | 输出偏好（png/jpg、是否导出 cubemap）            |

`output` 建议：

```json
{ "format": "png", "need_cubemap": false, "need_depth": false }
```

------

### 2.6 `modules.motion`（动作模块）

MVP：AnimationGPT 文本驱动动作，输出 BVH。

| 字段                         | 类型    | 必填 | 说明                                       |
| ---------------------------- | ------- | ---- | ------------------------------------------ |
| modules.motion.enabled       | boolean | R    | 是否启用                                   |
| modules.motion.prompt        | string  | R*   | 动作 prompt（enabled=true 必填）           |
| modules.motion.duration_s    | number  | O    | 不填则用 intent.duration_s                 |
| modules.motion.fps           | number  | O    | 默认 30                                    |
| modules.motion.style         | string  | O    | 动作风格（写实/卡通/格斗…）                |
| modules.motion.action_params | object  | O    | 结构化动作参数（如果 AnimationGPT 支持）   |
| modules.motion.postprocess   | object  | O    | 裁剪、平滑、拼接等后处理策略（可先不实现） |

`postprocess`（预留）：

```json
{
  "trim": { "start_s": 0, "end_s": 12 },
  "smooth": { "enabled": true, "strength": 0.5 }
}
```

------

### 2.7 `modules.music`（音乐模块）

MVP：MusicGPT.exe CLI，输出 wav。

| 字段                     | 类型    | 必填 | 说明                                        |
| ------------------------ | ------- | ---- | ------------------------------------------- |
| modules.music.enabled    | boolean | R    | 是否启用                                    |
| modules.music.prompt     | string  | R*   | 音乐 prompt（enabled=true 必填）            |
| modules.music.duration_s | number  | O    | 不填则用 intent.duration_s                  |
| modules.music.tempo_bpm  | number  | O    | 可用于 prompt 增强（模型不一定原生支持）    |
| modules.music.genre      | string  | O    | 风格标签（cinematic/orchestral/synthwave…） |
| modules.music.output     | object  | O    | 输出参数：采样率/格式（受模型限制）         |

------

### 2.8 `modules.character`（角色模块，MVP 可简化为“选择预制角色”）

你们文档里提到“内置预绑定骨骼模型库 + 自动重定向”是更务实路径，此处先把接口定好。

| 字段                           | 类型    | 必填 | 说明                                    |
| ------------------------------ | ------- | ---- | --------------------------------------- |
| modules.character.enabled      | boolean | R    | 是否启用（MVP 可默认 true，用预制角色） |
| modules.character.character_id | string  | O    | UI 选择的预制角色 ID                    |
| modules.character.style        | string  | O    | 角色风格（写实/卡通等）                 |
| modules.character.retarget     | object  | O    | 重定向参数（骨骼映射表、IK 修正等）     |

------

### 2.9 `modules.preview`（预览模块）

MVP：后端生成一个 `preview_config.json`，前端按配置加载 skybox + 角色 + 动作 + 音乐。

| 字段                          | 类型    | 必填 | 说明                             |
| ----------------------------- | ------- | ---- | -------------------------------- |
| modules.preview.enabled       | boolean | R    | 是否启用                         |
| modules.preview.camera_preset | string  | O    | `orbit/front/closeup/cinematic`  |
| modules.preview.autoplay      | boolean | O    | 默认 true                        |
| modules.preview.timeline      | object  | O    | 时间轴对齐策略：起点、淡入淡出等 |

------

### 2.10 `modules.export`（导出模块）

MVP 可先只导出资产包（zip），或导出一个“工程文件”。视频导出接口先定下来便于后续加 ffmpeg/blender。

| 字段                      | 类型             | 必填 | 说明                                     |
| ------------------------- | ---------------- | ---- | ---------------------------------------- |
| modules.export.enabled    | boolean          | R    | 是否启用                                 |
| modules.export.format     | string           | O    | `mp4/webm/zip`（MVP 可默认 zip）         |
| modules.export.resolution | [number, number] | O    | 默认 `[1920,1080]`                       |
| modules.export.fps        | number           | O    | 默认 30                                  |
| modules.export.bitrate    | string           | O    | `"8M"` 等                                |
| modules.export.include    | string[]         | O    | 导出包含：scene/motion/music/manifest 等 |

------

### 2.11 `constraints`（全局约束）

| 字段                      | 类型   | 必填 | 说明                             |
| ------------------------- | ------ | ---- | -------------------------------- |
| constraints.max_runtime_s | number | O    | 超时控制（默认 600）             |
| constraints.quality       | string | O    | `fast/standard/high`             |
| constraints.safety        | object | O    | 内容安全策略（MVP 可只做黑名单） |

------

### 2.12 `runtime`（执行策略）

| 字段                    | 类型   | 必填 | 说明                               |
| ----------------------- | ------ | ---- | ---------------------------------- |
| runtime.priority        | number | O    | 0-10，默认 5                       |
| runtime.concurrency_key | string | O    | 并发隔离键（如 `gpu0`）            |
| runtime.locks           | object | O    | 资源锁：`{"gpu": "cuda:0"}`        |
| runtime.fallback        | object | O    | 主模型失败时的备选路由             |
| runtime.cache_policy    | object | O    | 缓存策略（MVP 可忽略，但字段预留） |

------

### 2.13 `hooks`（扩展回调/事件）

| 字段               | 类型    | 必填 | 说明                         |
| ------------------ | ------- | ---- | ---------------------------- |
| hooks.webhook_url  | string  | O    | 完成/失败回调（以后可加）    |
| hooks.event_stream | boolean | O    | 是否开启 SSE/WS（建议 true） |

------

## 3. UIR 生成与落盘规范（强烈建议）

### 3.1 Job 目录结构（统一资产组织）

建议所有任务输出放在：

```
/assets/<job_id>/
  uir.json
  manifest.json
  logs/
    orchestrator.log
    motion.log
    music.log
    scene.log
  scene/
    panorama.png
    cubemap/ (optional)
  motion/
    motion.bvh
    motion_meta.json
  music/
    music.wav
  preview/
    preview_config.json
  export/
    final.mp4 (optional)
    bundle.zip (optional)
```

### 3.2 manifest.json（聚合输出的“作品清单”）

编排中枢在各 Adapter 完成后统一生成 `manifest.json`：

```json
{
  "job_id": "xxx",
  "uir_version": "1.0",
  "created_at": "2025-12-20T00:00:00Z",
  "status": "DONE",
  "inputs": { "raw_prompt": "...", "style": "cinematic", "duration_s": 12 },
  "outputs": {
    "scene": { "panorama": { "uri": "/assets/xxx/scene/panorama.png", "mime": "image/png" } },
    "motion": { "bvh": { "uri": "/assets/xxx/motion/motion.bvh", "mime": "text/plain" }, "fps": 30, "duration_s": 12 },
    "music": { "wav": { "uri": "/assets/xxx/music/music.wav", "mime": "audio/wav" }, "duration_s": 12 },
    "preview": { "config": { "uri": "/assets/xxx/preview/preview_config.json", "mime": "application/json" } },
    "export": { "mp4": null, "zip": null }
  },
  "errors": []
}
```

------

## 4. Adapter 统一接口（协议层）

你们可以实现成：

- **Python 类接口**（单体后端内部调用，最快）
- 或 **HTTP 微服务接口**（更像你们架构设计文档里的微服务分层，后续扩展方便）

下面给出两种接口规范（建议你先走 Python 内部接口，稳定后再服务化）。

------

### 4.1 Python 内部接口（推荐 MVP）

#### 4.1.1 Adapter 基类协议

```python
class AdapterResult(TypedDict):
    ok: bool
    provider: str
    artifacts: list[dict]      # AssetRef[]
    meta: dict                 # 任意结构化信息
    warnings: list[str]
    error: dict | None         # 标准错误结构

class ProgressReporter(Protocol):
    def stage(self, name: str, progress: float, message: str = "", extra: dict | None = None) -> None: ...
    def log(self, line: str) -> None: ...

class ModelAdapter(Protocol):
    provider_id: str           # 如 "musicgpt_cli"
    modality: str              # "music" / "motion" / "scene" / "preview" / "export"
    max_concurrency: int       # 通常 GPU=1

    def validate(self, uir: dict) -> None: ...
    def run(self, uir: dict, out_dir: Path, reporter: ProgressReporter) -> AdapterResult: ...
```

#### 4.1.2 标准错误结构（所有 Adapter 一致）

```json
{
  "code": "E_MODEL_RUNTIME",
  "message": "MusicGPT failed",
  "detail": { "exit_code": 1, "stderr_tail": "..." },
  "retryable": true
}
```

错误码建议统一前缀：

- `E_VALIDATION_*`（参数校验）
- `E_DEPENDENCY_*`（依赖/环境缺失）
- `E_MODEL_RUNTIME`（模型运行错误）
- `E_TIMEOUT`
- `E_IO_*`（文件读写、磁盘空间）
- `E_UNSUPPORTED`（当前 provider 不支持该参数）

------

### 4.2 HTTP 微服务接口（可选）

每个 adapter 服务暴露：

- `POST /v1/run`：提交任务（同步或异步）
- `GET /v1/health`：健康检查
- `GET /v1/capabilities`：能力描述（支持哪些参数）

`POST /v1/run` 请求体统一为：

```json
{ "job_id": "xxx", "uir": { ... }, "out_dir": "/assets/xxx" }
```

返回：

```json
{ "ok": true, "provider": "...", "artifacts": [ ... ], "meta": { ... } }
```

------

# 5. 各 Adapter 输入/输出定义（接口文档版）

下面以 **provider_id** 为索引，给出每个 Adapter 的 I/O 契约、必填字段、输出资产、可选参数、失败语义。

------

## 5.1 Motion｜AnimationGPTAdapter（provider_id: `animationgpt_local`）

### 5.1.1 适用目标

- 生成 BVH 动作文件（后续可用于 Web 播放、重定向到预制角色）。

### 5.1.2 输入（从 UIR 读取）

必需：

- `intent.duration_s`（或 `modules.motion.duration_s`）
- `modules.motion.prompt`
- `modules.motion.fps`（默认 30）

可选：

- `modules.motion.style`
- `modules.motion.action_params`（若 AnimationGPT 支持结构化动作控制）
- `constraints.quality`（fast/standard/high，映射到推理参数）
- `runtime.locks.gpu`（如需固定 cuda 设备）

### 5.1.3 输出（Artifacts）

必须产出：

1. `motion/motion.bvh`（role: `motion_bvh`）
2. `motion/motion_meta.json`（role: `motion_meta`）

`motion_meta.json` 建议结构：

```json
{
  "fps": 30,
  "duration_s": 12.0,
  "frames": 360,
  "skeleton": "SMPL_22",
  "source_provider": "animationgpt_local",
  "prompt_used": "...",
  "notes": []
}
```

### 5.1.4 Result 示例

```json
{
  "ok": true,
  "provider": "animationgpt_local",
  "artifacts": [
    { "role": "motion_bvh", "uri": "/assets/xxx/motion/motion.bvh", "mime": "text/plain" },
    { "role": "motion_meta", "uri": "/assets/xxx/motion/motion_meta.json", "mime": "application/json" }
  ],
  "meta": { "fps": 30, "duration_s": 12, "frames": 360 },
  "warnings": [],
  "error": null
}
```

### 5.1.5 校验规则（validate 必须做）

- `modules.motion.enabled=true` 时：`modules.motion.prompt` 非空。
- `fps` ∈ [15, 60]
- `duration_s` ∈ [1, 60]（你们可根据产品限制调整）
- 输出目录可写、磁盘空间充足

### 5.1.6 失败与可重试

- 模型崩溃/显存不足 → `E_MODEL_RUNTIME`（retryable=true，可降级为低质量/短时长）
- prompt 为空/非法 → `E_VALIDATION_INPUT`（retryable=false）

------

## 5.2 Music｜MusicGPTCliAdapter（provider_id: `musicgpt_cli`）

### 5.2.1 适用目标

- 通过命令行调用 `MusicGPT.exe`，生成 `.wav` 音频。

### 5.2.2 输入（从 UIR 读取）

必需：

- `modules.music.prompt`
- `modules.music.duration_s` 或 `intent.duration_s`

可选：

- `intent.language_policy.auto_translate_to_en`（若为 true，adapter 内部可调用你们已有 `_maybe_zh_to_en`）
- `runtime.priority`（用于队列排序，不影响模型）
- `constraints.quality`（映射到你们 prompt 增强策略）

### 5.2.3 CLI 映射（实现层约定）

- 位置参数 1：prompt（最终传给 exe 的字符串，建议是英文；中文走翻译）
- 可选参数：`--secs <duration>`（秒）
- 必选参数：`--output <path>`（输出目标 wav 路径）
- 同步版：先写 `.part` 再 rename（adapter 要等待最终文件存在）
- 异步版：直接写最终路径并等待完成（adapter 轮询或阻塞等待）

### 5.2.4 输出（Artifacts）

必须产出：

1. `music/music.wav`（role: `music_wav`）
2. `music/music_meta.json`（role: `music_meta`）

`music_meta.json` 建议结构：

```json
{
  "duration_s": 12,
  "sample_rate": 44100,
  "channels": 2,
  "provider": "musicgpt_cli",
  "prompt_original": "中文或英文",
  "prompt_used": "最终传给 exe 的英文",
  "cmdline": "可选（注意脱敏）"
}
```

### 5.2.5 Result 示例

```json
{
  "ok": true,
  "provider": "musicgpt_cli",
  "artifacts": [
    { "role": "music_wav", "uri": "/assets/xxx/music/music.wav", "mime": "audio/wav" },
    { "role": "music_meta", "uri": "/assets/xxx/music/music_meta.json", "mime": "application/json" }
  ],
  "meta": { "duration_s": 12 },
  "warnings": [],
  "error": null
}
```

### 5.2.6 校验规则

- `modules.music.enabled=true` 时：`modules.music.prompt` 非空
- `duration_s` ∈ [3, 60]（按你们 exe 能力调整）
- MusicGPT.exe 存在、可执行
- 输出路径目录存在

### 5.2.7 失败与可重试

- exe 退出码非 0 → `E_MODEL_RUNTIME`（retryable=true）
- 生成超时 → `E_TIMEOUT`（retryable=true，可降低 duration_s）
- 输出 wav 不存在 → `E_IO_WRITE`（retryable=true）

------

## 5.3 Scene｜Diffusion360Adapter（provider_id: `diffusion360_local`）

### 5.3.1 适用目标

- 生成无缝 360 全景图（equirectangular panorama），用于 skybox/环境贴图。

### 5.3.2 输入（从 UIR 读取）

必需：

- `modules.scene.prompt`
- `modules.scene.resolution`（默认 `[2048,1024]` 可内置）

可选：

- `modules.scene.negative_prompt`
- `modules.scene.seed`
- `modules.scene.steps`
- `modules.scene.cfg_scale`
- `modules.scene.upscale`
- `constraints.quality`（映射到 steps、resolution、upscale）

### 5.3.3 输出（Artifacts）

必须产出：

1. `scene/panorama.png`（role: `scene_panorama`）
2. `scene/scene_meta.json`（role: `scene_meta`）

可选产出（你们后续做）：

- `scene/cubemap/px.png ... nz.png`（role: `scene_cubemap_faces`）
- `scene/depth.png`（role: `scene_depth`）

`scene_meta.json`：

```json
{
  "width": 2048,
  "height": 1024,
  "seed": 123,
  "steps": 30,
  "cfg_scale": 7.0,
  "provider": "diffusion360_local",
  "prompt_used": "...",
  "negative_prompt": "..."
}
```

### 5.3.4 校验规则

- `modules.scene.enabled=true` 时：`modules.scene.prompt` 非空
- resolution：width=2*height（全景常规比例建议）
- width ∈ [1024, 4096]，height ∈ [512, 2048]（按显存限制）
- 模型权重可加载，GPU 可用（或支持 CPU 模式但会慢）

### 5.3.5 失败与可重试

- OOM → `E_MODEL_RUNTIME`（retryable=true，降 resolution/steps）
- prompt 违规/为空 → `E_VALIDATION_INPUT`（retryable=false）

------

## 5.4 Character｜BuiltinCharacterSelector（provider_id: `builtin_library`）

> MVP 推荐：你们先用“预制角色库 + 统一骨骼”的方式跑通链路，再迭代自动绑骨/AI 角色生成。

### 5.4.1 输入

必需：

- `modules.character.enabled=true`

可选：

- `modules.character.character_id`（UI 选择）
- `modules.character.style`（用于自动挑选）
- `modules.motion.style`（用于匹配更合适的角色）

### 5.4.2 输出（Artifacts）

必须产出：

1. `character/character_manifest.json`（role: `character_manifest`）

可选产出：

- `character/model.glb`（role: `character_model_glb`）——如果你们把角色复制到 job 目录；否则用共享库 URL

`character_manifest.json`：

```json
{
  "character_id": "samurai_01",
  "model_uri": "/static/characters/samurai_01.glb",
  "skeleton": "SMPL_22",
  "scale": 1.0,
  "notes": []
}
```

------

## 5.5 Retarget｜BvhRetargetAdapter（provider_id: `bvh_retarget`，预留）

> 你们可能会做“AnimationGPT 输出 BVH → 重定向到某角色骨骼”的脚本化流程，这个适配器接口先定好。

输入：

- `motion/motion.bvh`（AssetRef 作为依赖）
- `character/model.glb` 或 character skeleton 定义

输出：

- `motion/retargeted.fbx` 或 `motion/retargeted.bvh`
- `motion/retarget_meta.json`

------

## 5.6 Preview｜PreviewConfigBuilder（provider_id: `web_threejs`）

### 5.6.1 目标

- 让前端无需猜测路径：只读一个 config，就能加载 scene、character、motion、music 并播放。

### 5.6.2 输入

依赖（必须已生成或可为空降级）：

- `scene_panorama`（可选：无则用默认背景）
- `motion_bvh`
- `music_wav`（可选：无则静音）
- `character_manifest`（无则用默认火柴人/骨架显示）

可选：

- `modules.preview.camera_preset`
- `modules.preview.autoplay`

### 5.6.3 输出（Artifacts）

- `preview/preview_config.json`（role: `preview_config`）

示例：

```json
{
  "scene": { "panorama_uri": "/assets/xxx/scene/panorama.png" },
  "character": { "model_uri": "/static/characters/samurai_01.glb", "skeleton": "SMPL_22" },
  "motion": { "bvh_uri": "/assets/xxx/motion/motion.bvh", "fps": 30 },
  "music": { "wav_uri": "/assets/xxx/music/music.wav", "offset_s": 0 },
  "camera": { "preset": "orbit", "auto_rotate": true },
  "timeline": { "duration_s": 12 }
}
```

------

## 5.7 Export｜FfmpegExportAdapter（provider_id: `ffmpeg_export`，可后续实现）

### 5.7.1 MVP 建议

- v1 先支持 `format=zip`：把 scene/motion/music/manifest/preview_config 打包，用户可下载工程资产包。
- v2 再支持 mp4：你们若走“前端录制 + 后端转码”或“后端离线渲染 + ffmpeg 合成”，都能挂到这个 Adapter 上。

### 5.7.2 输入

- `modules.export.format`
- `modules.export.resolution`, `modules.export.fps`
- 依赖 `preview` 或帧序列（看你们导出方案）

### 5.7.3 输出

- `export/bundle.zip`（role: `export_zip`）
- 或 `export/final.mp4`（role: `export_mp4`）

------

# 6. Planner（理解/拆分）输出规范：UIR 的生成规则（关键）

编排中枢的 Planner 负责：把 `input.raw_prompt` + `input.ui_choices` → 生成 `intent`、补全 `modules.*` prompt、填好 `routing`（或保持默认）。

### 6.1 Planner 最小输出要求（MVP）

必须保证：

- `intent.targets`：至少包含用户想要的产物；若用户只说“生成动作”，就只开 motion。
- `intent.duration_s`：没有就用 UI slider 默认（比如 12s）。
- `modules.motion.prompt` / `modules.scene.prompt` / `modules.music.prompt`：按 targets 补齐。
- `modules.*.enabled` 与 targets 一致。
- `routing` 可为空（让系统默认选 AnimationGPT/MusicGPT/Diffusion360）。

### 6.2 Prompt 拆分策略（推荐工程化规则）

给你一个非常可落地的模板（先规则后 LLM）：

- 从 `raw_prompt` 抽取：主体、场景、动作、音乐氛围、时长、风格
- 生成三个子 prompt：
  - **scene.prompt**：只描述环境（地点/时间/光照/材质/风格）+ “360 panorama, seamless”
  - **motion.prompt**：只描述动作（动词序列、强度、节奏）
  - **music.prompt**：只描述配乐（乐器/情绪/BPM/质感）

这样能显著提升多模型一致性（你们文档也强调了“语义一致性与工作流编排”的重要性）。

------

# 7. 并发、状态、事件（为 UI 实时反馈服务）

虽然你这次没有要求我写 Job API，但**接口文档版**强烈建议你把事件结构定下来，因为 UI 需要它（“动作生成中…”、“音乐生成中…”）。

### 7.1 Job 状态机（建议）

- `QUEUED`
- `PLANNING`
- `RUNNING_SCENE`
- `RUNNING_MOTION`
- `RUNNING_MUSIC`
- `BUILDING_PREVIEW`
- `EXPORTING`
- `DONE` / `FAILED` / `CANCELED`

### 7.2 进度事件（SSE/WS）

```json
{
  "job_id": "xxx",
  "stage": "RUNNING_MUSIC",
  "progress": 0.42,
  "message": "Generating music...",
  "ts": "2025-12-20T00:00:00Z",
  "artifacts_partial": []
}
```

------

# 8. 完整 UIR 示例（可直接用于联调）

```json
{
  "uir_version": "1.0",
  "job": { "id": "job_01", "created_at": "2025-12-20T00:00:00Z", "title": "Cyber Dojo" },
  "input": {
    "raw_prompt": "生成一个赛博朋克武士在雨夜训练的短片，12秒，史诗氛围",
    "lang": "zh",
    "ui_choices": { "style_card": "cinematic", "mood_card": "epic", "duration_s": 12, "quality": "standard" }
  },
  "intent": {
    "targets": ["scene", "motion", "music", "preview"],
    "duration_s": 12,
    "style": "cinematic",
    "mood": "epic",
    "language_policy": { "auto_translate_to_en": true, "preserve_original": true }
  },
  "routing": {
    "scene": { "provider": "diffusion360_local" },
    "motion": { "provider": "animationgpt_local" },
    "music": { "provider": "musicgpt_cli" },
    "character": { "provider": "builtin_library" },
    "preview": { "provider": "web_threejs" }
  },
  "modules": {
    "scene": {
      "enabled": true,
      "prompt": "A cyberpunk dojo in heavy rain at night, neon lights, wet ground reflections, cinematic lighting, 360 panorama, seamless",
      "negative_prompt": "blurry, seams, watermark, low quality",
      "resolution": [2048, 1024],
      "steps": 30,
      "cfg_scale": 7.0,
      "upscale": false
    },
    "motion": {
      "enabled": true,
      "prompt": "A samurai training routine: stance, quick slash combo, dodge, finishing pose. Powerful, rhythmic.",
      "fps": 30,
      "duration_s": 12
    },
    "music": {
      "enabled": true,
      "prompt": "Epic cinematic taiko + synth, tense and heroic, 120 bpm, rain ambiance",
      "duration_s": 12
    },
    "character": { "enabled": true, "character_id": "samurai_01" },
    "preview": { "enabled": true, "camera_preset": "orbit", "autoplay": true },
    "export": { "enabled": false }
  },
  "constraints": { "max_runtime_s": 600, "quality": "standard" },
  "runtime": { "priority": 5, "locks": { "gpu": "cuda:0" }, "fallback": {}, "cache_policy": { "mode": "off" } },
  "hooks": { "event_stream": true }
}
```

------

# 9. 你实现时最重要的三条“硬约束”（避免后期返工）

1. **所有 Adapter 输出必须只写入 `out_dir` 下自己的子目录**（不要写到散乱路径），并返回 `AssetRef`。
2. **manifest.json 是作品管理/预览/导出的唯一入口**：前端渲染作品卡片、详情页、导出按钮都只看 manifest。
3. **UIR 是可复现的“作品配方”**：以后你们做缓存、再生成、版本管理、A/B 模型对比，全靠 UIR 的稳定性。

------

如果你希望我再进一步把这份文档变成你们可以直接用的“强校验版本”，我可以继续给你补两样东西（仍然不需要你再提供信息）：

- **UIR 的 JSON Schema（draft-07）**：你们后端一行就能校验请求合法性
- **Adapter Capabilities 描述规范**（/capabilities 输出结构）：前端可动态渲染“当前机器支持哪些模型/分辨率/时长上限”