# foranimind 组织使用说明

项目统一迁移到 GitHub 组织 **foranimind** 里管理，主仓库是 **foranimind/animind**。以后所有代码协作都按下面流程走。

## 1\. 加入组织与找到仓库

1.  我邀请你加入组织后，请在 GitHub 通知/邮件里 **接受邀请**。

2.  进入组织页面 `foranimind` → Repositories → 打开 `animind` 仓库。

> 如果你之前 clone 过旧仓库（个人仓库地址），请把远程地址改成新的：

```bash
git remote set-url origin https://github.com/foranimind/create_web_origin.git
```

## 2\. 日常开发固定流程（必须遵守）

**不要在 main 上直接开发和提交。**

1.  更新 dev：

```bash
git checkout dev
git pull origin dev
```

2.  从 dev 创建你自己的功能分支：

```bash
git checkout -b feature/你的功能名
```

3.  在功能分支里写代码，阶段性提交：

```bash
git add .
git commit -m "feat: 说明你做了什么"
```

4.  推送分支到 GitHub：

```bash
git push -u origin feature/你的功能名
```

5.  去 GitHub 仓库页面创建 Pull Request（PR）：

-   base 选 `dev`

-   compare 选 `feature/你的功能名`

-   PR 描述里写清楚：

    -   改了什么

    -   怎么运行/怎么测试

6.  至少 1 人 Review 通过后（就是我）再合并。

## 3\. 提交与文件规范

-   不要提交大文件：`data/`、`checkpoints/`、`logs/`、模型权重等。

-   本地配置（key、token）放 `.env`，不要上传；仓库里只放 `.env.example`（如需要）。

-   commit message 写清楚：`feat/fix/docs/refactor/chore` 开头即可。

## 4\. 冲突怎么处理

当你 PR 前发现 dev 更新了：

```bash
git checkout dev
git pull origin dev
git checkout feature/你的功能名
git merge dev
# 解决冲突后再 commit + push
```

## 5\. 做任务的方式

-   先看仓库的 Issues，认领一个任务再开始做。

-   一个任务对应一个分支 + 一个 PR，别把很多无关内容塞进同一个 PR。
