# 中继服务器（Relay）设计说明

## 1. 目标与范围
Relay 部署在本地 GPU 机器，用于让云端 Orchestrator 通过最小 REST 接口调用本地模型或可执行程序，并异步获取结果。当前支持的本地执行器包括：
- AnimationGPT
- MusicGPT（exe）
- SD-T2I-360PanoImage

## 2. 架构与职责
- Orchestrator：负责任务编排、用户请求汇聚、回调终端（`/api/jobs/{job_id}/relay-upload`）。
- Relay：接受任务、排队与并发控制、调用本地模型、管理产物、回传产物。
- Local GPU 执行器：具体模型或可执行文件，运行在本地 GPU 机器。

## 3. Orchestrator ↔ Relay 最小 REST 契约
### 3.1 通用约定
- Header：`X-Relay-Token: <shared-token>`（必填，安全策略见第 6 节）
- Content-Type：`application/json`（下载产物除外）
- `task_id` 由 Relay 生成，`job_id` 由 Orchestrator 传入

### 3.2 POST /v1/tasks
创建任务，Relay 立即返回 `task_id`，任务进入队列。

Request (JSON):
```json
{
  "job_id": "job_123",
  "kind": "motion | scene | music",
  "input": {
    "prompt": "...",
    "assets": ["file://.../input.png"]
  },
  "options": {
    "seed": 123,
    "fps": 24
  },
  "callback_url": "https://orchestrator.example.com/api/relay/events"
}
```

Response (202):
```json
{
  "task_id": "task_abc",
  "status": "queued",
  "created_at": "2025-12-21T09:00:00Z"
}
```

### 3.3 GET /v1/tasks/{task_id}
查询任务状态与产物索引。

Response (200):
```json
{
  "task_id": "task_abc",
  "job_id": "job_123",
  "kind": "motion",
  "status": "running | uploading | succeeded | failed | canceled | queued",
  "progress": 0.55,
  "artifacts": [
    {
      "name": "preview.mp4",
      "content_type": "video/mp4",
      "size_bytes": 1048576,
      "sha256": "..."
    }
  ],
  "error": {
    "code": "EXEC_FAILED",
    "message": "..."
  }
}
```

### 3.4 GET /v1/tasks/{task_id}/artifacts/{name}（可选）
直接下载产物（适合小文件或调试场景）。

Response (200): 文件流

### 3.5 POST /v1/tasks/{task_id}/callback（可选）
为已创建的任务注册或更新回调地址。未设置时由 Orchestrator 轮询。

Request (JSON):
```json
{
  "callback_url": "https://orchestrator.example.com/api/relay/events",
  "events": ["queued", "running", "succeeded", "failed"]
}
```

Response (200):
```json
{
  "task_id": "task_abc",
  "callback_url": "https://orchestrator.example.com/api/relay/events",
  "events": ["queued", "running", "succeeded", "failed"]
}
```

## 4. 异步与状态机
### 4.1 状态机
最小状态集：
`queued -> running -> uploading -> succeeded`
`queued -> canceled`
`running -> failed`

说明：
- `queued`：已入队，等待 GPU 资源
- `running`：本地执行中
- `uploading`：产物回传中（Orchestrator `/api/jobs/{job_id}/relay-upload`）
- `succeeded` / `failed` / `canceled`：终态

### 4.2 队列与并发限制
- Relay 维护本地持久化队列（磁盘 + 内存索引）以支持重启恢复。
- 并发限制建议按 GPU 数量或模型类型配置：
  - `motion`（AnimationGPT）
  - `scene`（SD-T2I-360PanoImage）
  - `music`（MusicGPT exe）
- 队列按 `created_at` 或 `priority` 先进先出，超出并发上限时保持在 `queued`。

## 5. 产物回传与持久化
### 5.1 产物回传
Relay 在 `succeeded` 前必须回传产物到 Orchestrator：
```
POST {orchestrator_base}/api/jobs/{job_id}/relay-upload
Headers: X-Relay-Token: <shared-token>
Body: multipart/form-data 或 JSON + pre-signed URL
```
回传成功后进入 `succeeded`，失败时重试并保持 `uploading` 或转为 `failed`。

### 5.2 本地持久化
产物与任务元数据应落盘，便于断点恢复与复查：
- `task.json` 保存状态、进度、错误与产物索引
- 产物目录与中间文件分离（详见第 7 节）

## 6. 安全策略
- 共享 Token：所有请求必须携带 `X-Relay-Token`，Relay 仅接受匹配值。
- 网络边界：仅允许内网/VPN 访问，推荐 IP 白名单与防火墙规则。
- 日志脱敏：
  - 不记录 `X-Relay-Token`、预签名 URL、完整 prompt、密钥或用户隐私数据
  - 对 job_id / task_id 可记录，但禁止输出文件内容或原始二进制

## 7. 本地运行目录规范
### 7.1 Relay 运行目录
建议在项目根目录下创建：
```
relay_runtime/
  config/              # Relay 配置与并发参数
  tasks/{task_id}/
    input/             # 任务输入与引用文件
    work/              # 临时中间产物
    artifacts/         # 最终产物（可回传）
    task.json          # 状态与元数据
  logs/                # 运行日志
  tmp/                 # 临时文件
  model_cache/         # 模型或依赖缓存
```

### 7.2 Orchestrator runtime 区别
- Orchestrator runtime 主要保存轻量任务编排状态与调用日志，不包含 GPU 模型、执行器或大体积产物。
- Relay runtime 保持完整执行上下文与产物落盘，重点在本地 GPU 执行生命周期。

### 7.3 建议加入 gitignore 的目录
以下目录均为运行时数据，不应提交：
- `relay_runtime/`
- `relay_runtime/logs/`
- `relay_runtime/tmp/`
- `relay_runtime/tasks/**/artifacts/`
- `relay_runtime/model_cache/`
