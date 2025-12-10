# 本项目 Git 协作规范

## 1. 分支约定
- main：稳定分支，只通过 PR 从 dev 合并。
- dev：开发集成分支。
- feature/*：新功能。
- bugfix/*：修 bug。

## 2. 开发流程
1. 从 dev 更新最新代码
2. 从 dev 新建 feature 分支
3. 在 feature 分支开发，并多次小步 commit
4. 推送分支到远程，发 PR：feature → dev
5. 至少 1 人 Review 后合并 PR
6. 删除已合并的 feature 分支

## 3. Commit 信息格式
- feat: 新功能
- fix: 修复问题
- docs: 文档
- refactor: 重构
- chore: 其他杂项

## 4. 文件与目录规范
- 不要上传 data/、checkpoints/、logs/ 等大文件
- 环境配置用 .env，本地自建，仓库仅提供 .env.example
- 前端、后端、模型相关代码放在对应目录（后续逐步整理）

## 5. 新成员流程
1. 克隆仓库
2. 配环境（参见 README）
3. 从 dev 切第一个 feature 分支，完成一个小改动并通过 PR 流程
