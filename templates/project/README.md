# 创作项目

## 启动工作台

在项目根目录运行以下命令，然后在浏览器打开 [咔嚓工作台](http://127.0.0.1:24074)。

```sh
npx kacha
```

## 项目结构

```text
项目名/
├── README.md                # 项目介绍、目录与启动说明
├── AGENTS.md                # Codex 的制作与资产管理约定
├── package.json             # 项目名称、简介与 npm 依赖
├── package-lock.json        # npm 安装依赖时生成的锁文件
├── config/                  # 工作台项目配置，如项目图标 logo.svg
├── .env                     # 本机 OSS 配置和访问凭据
├── .gitattributes           # 媒体文件的 Git LFS 跟踪规则
├── .gitignore               # 排除凭据、依赖和临时文件等
├── .lfsconfig               # 项目的外部 Git LFS 标识
├── docs/
│   ├── story/            # 世界观与人、地、物之间的关系
│   ├── art/            # 视觉风格、造型与生成要求
│   └── other/            # 项目的补充设定
├── assets/
│   ├── characters/          # 角色原画、CG 三视图、特写与音色
│   ├── scenes/              # 场景主图、机位与空间参考
│   ├── props/               # 剧情道具
│   ├── audio/               # 可复用的音乐、音效与台词
│   └── other/               # 字标、图形、特效等素材
├── scripts/
│   └── <剧集>/       # 本集剧本及按集合成的视频片段
├── storyboard/
│   └── <剧集>/
│       └── <场次>/   # 本场分镜词、关键帧组图及其生图提示词、
│           │                # 即梦视频提示词和分镜视频片段
│           └── archive/     # 本场历次改版的分镜及对应素材
└── tmp/                     # 临时研究与制作文件
```

## 配置媒体存储

使用阿里云 OSS 与团队共享媒体时，在工作台打开 **全局设置 → 存储设置**，填写 Endpoint、Bucket、访问凭据和可选的路径前缀。保存后点击「测试连接」。配置保存在本机项目根目录的 `.env`，每位成员在自己的电脑上填写。

通过 Git 同步媒体时，先安装 Git LFS。在已初始化的 Git 仓库中，首次添加媒体前运行 `npx kacha lfs setup`。将 `.gitattributes`、`.lfsconfig` 和 `.gitignore` 随项目提交，之后照常使用 `git push` 和 `git pull`。

首次克隆已有项目时，用 `GIT_LFS_SKIP_SMUDGE=1 git clone <仓库地址>` 跳过媒体下载。进入项目并完成本机存储配置后，运行 `npx kacha lfs setup` 和 `git lfs pull` 下载媒体。
