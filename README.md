# 数字人动画 Web 项目（大创）

本仓库用于本小组大创项目的前端与相关后端脚本开发。

## 目录结构

- `animation-web/`：早期版本的前端项目（基于 XXX 框架，如 React/Vue）
- `vite-project/`：基于 Vite 的前端项目（当前主推版本）
- `animation_back.py`：动画/模型相关的后端脚本（临时）

> 后续计划：根据项目进展，将后端服务与大模型代码整理到 `backend/`、`models/` 等目录。

## 开发环境

- Node.js：版本 …
- 包管理工具：npm / pnpm / yarn
- Python：3.9，用于 `animation_back.py` 及后续模型相关代码

## 前端启动方法

```bash
cd vite-project
npm install
npm run dev
