# 项目 Git/GitHub 协作开发与维护指南

> 让项目组所有成员在 **同一套规则** 下使用 Git/GitHub，避免代码冲突、版本混乱和文件丢失。本人在2025年11月27日维护项目代码库心力交瘁，对于目前项目文档当中出现的种种乱象深恶痛绝，故撰写此份规范，望诸君戒之慎之！

------

## 1. 适用范围与基本原则

- 本指南适用于本项目所有代码仓库（前端、后端、大模型等统一在同一仓库或多个仓库时，都建议遵守）（大模型如果没有微调或者做出改动者按照原始文档和要求进行修改，不再按照本文档要求）。
- 默认使用 **Git + GitHub**。
- 默认使用 `main` 作为主分支，`dev` 作为日常开发分支。
- 所有改动都通过 **分支 + Pull Request（PR）+ 代码评审（Review）** 完成，避免直接在 `main` 上提交。

原则上本指南仅作为指南，实际上作为本项目代码管理**最高**准则，**animind代码提交宪法**。

**核心原则：**

1. 不在 `main` 上直接开发。请不要直接提交，否则一律打回。
2. 每个功能一个分支，每个分支一个清晰的目标。不写清楚不接受提交。强行提交直接回滚！！！！
3. 提交信息、分支名、目录结构尽量规范、统一。如果时间紧迫则必须写清楚修改内容与功能。
4. 大文件（数据集、模型权重、日志等）**不直接上传 GitHub**。不允许再上传屎山。即使是微信。

------

## 2. 仓库结构与必备文件

建议的项目结构（本人正在努力当中）：

```text
project-root/
├─ frontend/       # 前端代码
├─ backend/        # 后端代码（如有）
├─ models/         # 大模型相关代码（推理、训练）
├─ docs/           # 文档、说明书、调研报告
├─ scripts/        # 各类工具脚本
├─ .gitignore
├─ README.md
└─ CONTRIBUTING.md # 本指南（到时候视情况是否放在上面）
```

### 2.1 `.gitignore` 基本要求

至少建议忽略：

```gitignore
# Python
__pycache__/
*.pyc
.venv/
venv/
env/

# Node/Frontend
node_modules/
dist/
build/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# 项目相关
data/
checkpoints/
logs/
outputs/
```

> 说明：数据集、模型权重、日志等统一放在 `data/`、`checkpoints/` 等目录，在 `.gitignore` 中忽略。这一点十分重要！！！！用AI写代码的同学需要注意！记得提出明确要求！即生成的文件不要随便放！！！！！

本人目前所采用的.gitignore文件如下：

```gitignore
# Dependencies
node_modules/
frontend/node_modules/

# Musicdata
Musicdata/
outputs/
public/Musicdata/
public/outputs/

# music
*.wav
*.ogg
*.mp3

# video
*.mp4
*.mov

# app
*.exe
*.app
*.dmg

# Model
AnimationGPT/

# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
.venv/
venv/
ENV/
env/
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# Build outputs
frontend/dist/
frontend/build/
*.local

# Environment variables
.env
.env.local
.env.development
.env.production
.env.development.local
.env.production.local
.env.test.local
frontend/.env
frontend/.env.local
frontend/.env.development.local
frontend/.env.production.local

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Editor directories and files
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
.vscode/*
!.vscode/extensions.json

# Testing
coverage/
*.cover
.hypothesis/
.pytest_cache/
.coverage
.coverage.*

# Cache
.cache/
.parcel-cache/
.eslintcache
.stylelintcache

# Temporary files
*.tmp
*.temp
.temp/
.tmp/

# Database
*.db
*.sqlite
*.sqlite3

# Data files (if they shouldn't be tracked)
data/

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Package manager lock files (optional - remove if you want to track them)
package-lock.json
# yarn.lock
# pnpm-lock.yaml
```

不要上传一百多兆的文件。否则一律退回，并前往寝室打死。

### 2.2 `README.md`

至少包含：

- 项目简介
- 目录结构说明
- 开发环境要求（Python/Node 版本等）
- 前端启动方法
- 模型/后端启动方法
- 常见问题（FAQ）

以上内容本人会负责撰写，需要经过集体审核。请大家一定要仔细阅读撰写的内容是否符合实际。

------

## 3. 分支管理规范

### 3.1 分支类型

~~推荐~~只允许使用以下几类分支：

- `main`：主分支
  - 始终保持 **可运行、相对稳定**。
  - 只从 `dev` 合并，不直接在 `main` 提交。
- `dev`：开发集成分支
  - 集中合并所有功能分支。
  - 日常开发从 `dev` 分出新分支。
- `feature/*`：新功能分支
  - 用于实现某个具体功能或模块。
  - 例如：`feature/frontend-login-page`、`feature/model-inference-api`
- `bugfix/*`：修复 bug 分支
  - 例如：`bugfix/fix-login-redirect`、`bugfix/fix-loss-nan`
- `hotfix/*`：紧急线上修复（如以后有正式部署可考虑）

### 3.2 分支命名规则

- 使用全小写，单词用 `-` 分隔。
- 可带 Issue 编号，例如：`feature/12-model-inference-api`。
- 示例：
  - `feature/frontend-player`
  - `feature/23-a2-experiment-log-export`
  - `bugfix/fix-api-timeout`

------

## 4. 每个人的开发流程（规范版）

> **统一约定：任何人不得在 `main` 上直接提交代码。违反者打死**

**步骤：**

1. **同步最新代码**

   ```bash
   git checkout dev
   git pull origin dev
   ```

2. **从 `dev` 新建功能分支**

   ```bash
   git checkout -b feature/frontend-login-page
   ```

3. **在功能分支上开发代码**

   - 编写/修改代码
   - 本地跑通基本测试（例如前端能启动、脚本能运行）

4. **本地提交（多次、小步提交）**

   ```bash
   git status       # 查看修改
   git add .        # 或按文件选择性提交
   git commit -m "feat(frontend): 实现基础登录页面 UI"
   ```

5. **推送到远程**

   ```bash
   git push -u origin feature/frontend-login-page
   ```

6. **在 GitHub 上创建 Pull Request**

   - base 选 `dev`
   - compare 选 `feature/frontend-login-page`
   - 在 PR 描述中写清：
     - 做了什么改动
     - 如何运行和测试
     - 是否解决某个 Issue（如：`Close #12`）

7. **代码评审（Review）**

   - 至少 1 名组员 Review 通过后再合并。
   - 有问题先在 PR 下讨论、修改，再合并。

8. **合并完成后**

   - 功能分支可以删除：

     ```bash
     git branch -d feature/frontend-login-page          # 删本地
     git push origin --delete feature/frontend-login-page  # 删远程
     ```

------

## 5. Commit 提交信息规范

统一风格可以让历史记录更清晰。不要自己乱来。本人维护项目时就出现过这种情况，现在还存在于git提交文件目录当中，诸君引以为戒。

推荐格式：

```text
<类型>(可选范围): 描述
```

常见类型：

- `feat`：新功能
- `fix`：修复 bug
- `refactor`：重构（非功能改变）
- `docs`：仅修改文档
- `style`：格式调整，代码风格（不影响逻辑）
- `chore`：杂项修改（配置、脚本等）
- `test`：添加或修改测试

示例：

- `feat(models): 新增 优化器`
- `fix(frontend): 修复播放器在 Edge 下的自动播放问题`
- `docs: 补充 README 中的安装说明`
- `chore: 更新 .gitignore 忽略 checkpoints 目录`

------

## 6. Pull Request（PR）规范

### 6.1 PR 创建要求

PR 标题建议：

```text
[feat] 前端登录页面基础实现
[fix] 修复模型推理接口超时问题
```

PR 描述建议包含：

- 变更内容（列点）
- 影响范围（前端/后端/模型等）
- 测试说明（如何验证改动）

示例描述：

> **变更内容：**
>
> - 新增 `frontend/src/pages/Login.tsx` 登录页面
> - 接入现有登录 API `/api/login`
> - 调整路由配置，添加 `/login` 路由
>
> **测试方法：**
>
> ```bash
> cd frontend
> npm install
> npm run dev
> ```
>
> - 打开 `http://localhost:5173/login`，测试账号密码登录流程

### 6.2 Review 规则（可按项目情况调整）

- 每个 PR 至少 1 名组员 Review 通过。
- Reviewer 可以从以下几个方面检查：
  - 功能是否符合需求
  - 是否破坏现有接口兼容性
  - 代码是否易读、命名是否清晰
  - 是否有多余的调试输出、无用文件
  - 是否有明显性能问题

------

## 7. Issue 管理规范（任务/Bug 跟踪）

建议在 GitHub 的 Issues 中管理任务和 Bug：

- 每一个“需求 / 功能 / Bug”，对应一个 Issue。
- Issue 内容建议写：
  - 背景与目标
  - 详细说明
  - 验收标准（期望结果）
  - 关联模块（前端/后端/模型）

示例 Issue 标题：

- `#12 实现模型推理 API`
- `#23 优化实验日志导出格式`
- `#31 修复前端播放控件在移动端错位的问题`

在 PR 中引用相关 Issue：

- 在 PR 描述中加入 `Close #12`
   合并 PR 时 Issue 会自动关闭。

------

## 8. 环境与依赖管理

### 8.1 Python 项目

- 使用 `requirements.txt` 或 `pyproject.toml` 统一依赖。坏习惯改掉！东边写一个环境文件西边丢一个环境文档。

- 不提交虚拟环境目录（`venv/`, `.venv/`）。切记！切记！

- 可以在 `README` 中说明：

  ```bash
  python -m venv .venv
  source .venv/bin/activate  # Windows 使用 .venv\Scripts\activate
  pip install -r requirements.txt
  ```

### 8.2 前端项目

- 使用 `package.json` 管理依赖。

- 不提交 `node_modules/`。以及一大堆网站构筑文件！！！！！！恶心至极！！！！

- 在 `README` 中说明：

  ```bash
  cd frontend
  npm install
  npm run dev
  ```

### 8.3 配置与密钥

- 密钥、Token、密码等**绝对不要提交到仓库**。开发阶段可以使用，但是后续阶段要逐步采用掩码或者其他方式，不要明码传输。
- 使用 `.env` 文件进行本地配置，在 `.gitignore` 忽略。
- 仓库中可以提供 `.env.example`，说明需要配置哪些变量。

------

## 9. 大文件（数据集、模型权重）的处理

- 不要把几百 MB 或数 GB 的文件直接提交到 GitHub。不要把几百 MB 或数 GB 的文件直接提交到 GitHub。不要把几百 MB 或数 GB 的文件直接提交到 GitHub。

- 建议统一放在：

  - 学校实验室服务器（我试着看能不能建成）
  - 阿里云 OSS/网盘（阿里云够呛，可能性不大；网盘根据大家情况而定）
  - 本地（最基础方案）

- 在仓库中：

  - 使用 `DOWNLOAD.md` 或 `docs/data_and_models.md` 写明下载方式和目录结构。

  - 示例说明：

    ```markdown
    ## 数据与模型获取
    
    - A1 实验数据集：链接 + 提取码
    - 模型权重 `checkpoint_v1.pt`：链接 + 保存到 `checkpoints/` 目录
    ```

------

## 10. 合并到 `main` 与版本发布

在以下节点，可以从 `dev` 合并到 `main`：

- 阶段汇报前
- 提交作业前（数字人小组）
- 对外展示前

推荐流程：

1. 确保 `dev` 稳定（所有必要功能已合并，测试通过）。

2. 本地或 GitHub 上发起 `dev → main` 的 PR。

3. 由本人（即周盟）检查、合并。

4. 合并后在 `main` 上打 Tag 标记版本，例如：

   ```bash
   git checkout main
   git pull origin main
   git tag v0.1.0
   git push origin v0.1.0
   ```

------

## 11. 冲突与常见问题处理

### 11.1 更新远程导致冲突

- 先在本地更新：

  ```bash
  git checkout dev
  git pull origin dev
  git checkout feature/xxx
  git merge dev
  ```

- 如果出现冲突：

  - 用编辑器打开冲突文件，手动修改。

  - 修改后：

    ```bash
    git add <file>
    git commit
    ```

  - 再推送到远程。

> 原则：**谁改动了冲突部分，谁负责解决。**
>
> 具体：冲突部分最终**一律由本人解决。**

------

## 12. ~~新成员~~新设备加入流程

1. 安装 Git、Node.js、Python（按 README 要求）。

2. 克隆仓库：

   ```bash
   git clone <repo-url>
   cd project-root
   ```

3. 按 README 配置环境、运行项目。

4. 从 `dev` 切出自己的第一个 `feature/*` 分支，做一个小改动（例如修复一个小 bug 或补充文档），走一遍完整流程（分支 → commit → PR → Review → 合并）。

要么是新成员，要么是新终端，总之，必须遵守本规范。