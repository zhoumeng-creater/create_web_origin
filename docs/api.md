# API 文档（apps/web）

## 0. 概览

| 项 | 说明 |
| --- | --- |
| 适用前端 | apps/web（Vite + React + TS） |
| 鉴权 | 无登录、无鉴权 |
| 数据格式 | `application/json; charset=utf-8` |
| 时间格式 | ISO 8601（UTC），示例：`2025-12-20T12:00:00Z` |

## 1. 核心接口（与 FastAPI 实现一致）

| 接口 | Method | 说明 |
| --- | --- | --- |
| `/api/jobs` | `POST` | 创建任务，`{ prompt, options? }` -> `{ job_id }` |
| `/api/jobs/{job_id}` | `GET` | 查询状态 |
| `/api/jobs/{job_id}/events` | `GET` | SSE 订阅任务事件 |
| `/assets/{job_id}/...` | `GET` | 静态资源（manifest / scene / motion / music 等） |

## 2. Job 状态机与 UI 展示

| status | 含义 | UI 建议展示 |
| --- | --- | --- |
| `QUEUED` | 已入队，等待处理 | 灰色 “排队中”，显示队列提示 |
| `PLANNING` | 解析需求/生成计划 | 蓝色 “解析中”，可展示“理解需求”提示 |
| `RUNNING_MOTION` | 生成动作 | 蓝色 “生成动作中”，显示进度条 |
| `RUNNING_SCENE` | 生成场景 | 蓝色 “生成场景中”，显示进度条 |
| `RUNNING_MUSIC` | 生成音乐 | 蓝色 “生成音乐中”，显示进度条 |
| `COMPOSING_PREVIEW` | 合成预览资源 | 蓝色 “合成预览中”，显示进度条 |
| `EXPORTING_VIDEO` | 导出视频 | 蓝色 “导出视频中”，显示进度条 |
| `DONE` | 完成 | 绿色 “已完成”，展示下载与详情入口 |
| `FAILED` | 失败 | 红色 “失败”，展示错误原因与重试按钮 |
| `CANCELED` | 已取消 | 灰色 “已取消”，保留记录但不可继续 |

## 3. 数据结构

### 3.1 CreateJobRequest

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| prompt | string | 是 | 原始文本输入 |
| options | object | 否 | 任务选项 |

### 3.2 CreateJobOptions（options）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| targets | string[] | 否 | 产物类型，如 `["motion","music"]` |
| duration_s | number | 否 | 时长（秒） |
| style | string | 否 | 风格 |
| mood | string | 否 | 情绪 |
| export_video | boolean | 否 | 是否导出视频（默认 true） |

### 3.3 JobStatusResponse

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| status | string | 是 | 见状态机 |
| stage | string | 是 | 当前阶段（同状态机枚举） |
| progress | number | 是 | 0~100 |
| message | string | 是 | 可读状态信息 |
| created_at | string | 是 | 创建时间 |
| started_at | string | 否 | 开始执行时间 |
| ended_at | string | 否 | 完成/失败时间 |
| manifest_url | string | 否 | `/assets/{job_id}/manifest.json` |
| assets | object[] | 否 | 资源简表（可选） |

### 3.4 AssetItem（assets）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| role | string | 是 | `scene` / `motion` / `music` / `preview` / `export` |
| path | string | 是 | `/assets/{job_id}/...` |
| mime | string | 否 | MIME |
| bytes | number | 否 | 文件大小 |

## 4. SSE 事件约定

### 4.1 事件类型

| event | 说明 |
| --- | --- |
| `status` | 状态/进度/阶段变化（progress + stage） |
| `log` | 日志行（便于 UI 实时展示） |
| `asset` | 资产更新（asset_update） |
| `done` | 任务完成 |
| `failed` | 任务失败 |

### 4.2 事件数据结构

`data` 固定结构如下：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| job_id | string | 是 | 任务 ID |
| ts | string | 是 | 事件时间 |
| stage | string | 否 | 当前阶段 |
| progress | number | 否 | 0~100 |
| message | string | 否 | 文本说明 |
| payload | object | 否 | 事件负载 |

### 4.3 JSON 示例（可流式推送）

```text
event: status
data: {"job_id":"job_1001","ts":"2025-12-20T12:00:10Z","stage":"RUNNING_MOTION","progress":18,"message":"Generating motion","payload":{}}

event: log
data: {"job_id":"job_1001","ts":"2025-12-20T12:00:12Z","stage":"RUNNING_MOTION","progress":22,"message":"seed=42, fps=30","payload":{"level":"info","text":"Motion step 3/20"}}

event: asset
data: {"job_id":"job_1001","ts":"2025-12-20T12:00:40Z","stage":"RUNNING_MOTION","progress":60,"message":"motion ready","payload":{"role":"motion","path":"/assets/job_1001/motion/motion.bvh","mime":"text/plain"}}

event: done
data: {"job_id":"job_1001","ts":"2025-12-20T12:01:00Z","stage":"DONE","progress":100,"message":"done","payload":{"manifest_url":"/assets/job_1001/manifest.json"}}

event: failed
data: {"job_id":"job_1001","ts":"2025-12-20T12:01:05Z","stage":"RUNNING_MUSIC","progress":75,"message":"music failed","payload":{"code":"E_MODEL_RUNTIME","detail":"GPU OOM"}}
```

## 5. 接口说明

### 5.1 POST /api/jobs

创建任务，前端只需提交 `prompt` 与可选 `options`。

Request

```json
{
  "prompt": "A warrior dashes forward and slashes the enemy, epic orchestral music",
  "options": {
    "targets": ["scene", "motion", "music"],
    "duration_s": 12,
    "style": "cinematic",
    "mood": "epic",
    "export_video": true
  }
}
```

Response

```json
{
  "job_id": "job_1001"
}
```

### 5.2 GET /api/jobs/{job_id}

查询任务状态与阶段。

Response

```json
{
  "status": "RUNNING_MUSIC",
  "stage": "RUNNING_MUSIC",
  "progress": 62,
  "message": "Generating music",
  "created_at": "2025-12-20T12:00:00Z",
  "started_at": "2025-12-20T12:00:05Z",
  "manifest_url": "/assets/job_1001/manifest.json",
  "assets": [
    { "role": "motion", "path": "/assets/job_1001/motion/motion.bvh", "mime": "text/plain" }
  ]
}
```

### 5.3 GET /api/jobs/{job_id}/events

SSE 订阅任务事件，`event` 与 `data` 见第 4 节。

### 5.4 静态资源 /assets/{job_id}/...

典型目录结构：

```text
/assets/{job_id}/manifest.json
/assets/{job_id}/scene/scene.png
/assets/{job_id}/motion/motion.bvh
/assets/{job_id}/music/music.wav
```

## 6. 完整用例

### 6.1 用例 A：只生成 motion + music

**A1. 创建任务**

Request

```json
{
  "prompt": "A fighter performs a fast combo, upbeat electronic music",
  "options": {
    "targets": ["motion", "music"],
    "duration_s": 8
  }
}
```

Response

```json
{
  "job_id": "job_a001"
}
```

**A2. SSE 事件流**

```text
event: status
data: {"job_id":"job_a001","ts":"2025-12-20T12:00:10Z","stage":"RUNNING_MOTION","progress":10,"message":"Generating motion","payload":{}}

event: asset
data: {"job_id":"job_a001","ts":"2025-12-20T12:00:30Z","stage":"RUNNING_MOTION","progress":55,"message":"motion ready","payload":{"role":"motion","path":"/assets/job_a001/motion/motion.bvh","mime":"text/plain"}}

event: status
data: {"job_id":"job_a001","ts":"2025-12-20T12:00:40Z","stage":"RUNNING_MUSIC","progress":60,"message":"Generating music","payload":{}}

event: asset
data: {"job_id":"job_a001","ts":"2025-12-20T12:00:55Z","stage":"RUNNING_MUSIC","progress":85,"message":"music ready","payload":{"role":"music","path":"/assets/job_a001/music/music.wav","mime":"audio/wav"}}

event: done
data: {"job_id":"job_a001","ts":"2025-12-20T12:01:00Z","stage":"DONE","progress":100,"message":"done","payload":{"manifest_url":"/assets/job_a001/manifest.json"}}
```

**A3. 查询状态**

```json
{
  "status": "DONE",
  "stage": "DONE",
  "progress": 100,
  "message": "done",
  "created_at": "2025-12-20T12:00:00Z",
  "started_at": "2025-12-20T12:00:05Z",
  "ended_at": "2025-12-20T12:01:00Z",
  "manifest_url": "/assets/job_a001/manifest.json",
  "assets": [
    { "role": "motion", "path": "/assets/job_a001/motion/motion.bvh", "mime": "text/plain" },
    { "role": "music", "path": "/assets/job_a001/music/music.wav", "mime": "audio/wav" }
  ]
}
```

**A4. 静态资源访问**

```text
/assets/job_a001/manifest.json
/assets/job_a001/motion/motion.bvh
/assets/job_a001/music/music.wav
```

### 6.2 用例 B：生成 scene + motion + music，且 export_video=false

**B1. 创建任务**

Request

```json
{
  "prompt": "A cyberpunk dojo in heavy rain, samurai training, epic music",
  "options": {
    "targets": ["scene", "motion", "music"],
    "duration_s": 12,
    "export_video": false
  }
}
```

Response

```json
{
  "job_id": "job_b001"
}
```

**B2. SSE 事件流**

```text
event: status
data: {"job_id":"job_b001","ts":"2025-12-20T12:10:10Z","stage":"RUNNING_SCENE","progress":12,"message":"Generating scene","payload":{}}

event: asset
data: {"job_id":"job_b001","ts":"2025-12-20T12:10:35Z","stage":"RUNNING_SCENE","progress":45,"message":"scene ready","payload":{"role":"scene","path":"/assets/job_b001/scene/scene.png","mime":"image/png"}}

event: status
data: {"job_id":"job_b001","ts":"2025-12-20T12:10:50Z","stage":"RUNNING_MOTION","progress":55,"message":"Generating motion","payload":{}}

event: status
data: {"job_id":"job_b001","ts":"2025-12-20T12:11:10Z","stage":"RUNNING_MUSIC","progress":75,"message":"Generating music","payload":{}}

event: done
data: {"job_id":"job_b001","ts":"2025-12-20T12:11:30Z","stage":"DONE","progress":100,"message":"done","payload":{"manifest_url":"/assets/job_b001/manifest.json"}}
```

**B3. 查询状态**

```json
{
  "status": "DONE",
  "stage": "DONE",
  "progress": 100,
  "message": "done",
  "created_at": "2025-12-20T12:10:00Z",
  "started_at": "2025-12-20T12:10:05Z",
  "ended_at": "2025-12-20T12:11:30Z",
  "manifest_url": "/assets/job_b001/manifest.json",
  "assets": [
    { "role": "scene", "path": "/assets/job_b001/scene/scene.png", "mime": "image/png" },
    { "role": "motion", "path": "/assets/job_b001/motion/motion.bvh", "mime": "text/plain" },
    { "role": "music", "path": "/assets/job_b001/music/music.wav", "mime": "audio/wav" }
  ]
}
```

**B4. 静态资源访问**

```text
/assets/job_b001/manifest.json
/assets/job_b001/scene/scene.png
/assets/job_b001/motion/motion.bvh
/assets/job_b001/music/music.wav
```
