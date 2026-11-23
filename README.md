# 咔嚓 · kacha

咔嚓是面向创作项目的本地制作工作台。当前版本覆盖资产管理，可浏览、创建和更新角色、场景、道具、其他素材与音频，并查看版本归档。工作台支持简体中文和英文，默认显示简体中文。

## 开始使用

新建一个项目目录并进入其中。npm 包发布后，可按项目安装：

```sh
mkdir my-project
cd my-project
npm install --save-dev @2kog/kacha
npx kacha init
npx kacha
```

常用多个项目时，也可以全局安装一次，再到各项目目录执行初始化和启动命令：

```sh
npm install -g @2kog/kacha
mkdir my-project
cd my-project
kacha init
kacha
```

启动后访问 `http://127.0.0.1:24074`。可以通过 `kacha /path/to/project --port 24075` 指定项目路径和端口。按项目安装时，在命令前加 `npx`。

## 项目结构

```text
my-project/
├── .env
├── .gitattributes
├── .gitignore
├── .lfsconfig
├── AGENTS.md
├── README.md
└── assets/
    ├── characters/
    ├── scenes/
    ├── props/
    ├── other/
    └── audio/
```

每个资产库附有目录说明。单项资产用 `index.json` 登记元数据，用 `README.md` 记录制作说明。需要分组时，可在每层分组目录放置 `group.json`。`kacha init` 会补齐空白 OSS 配置 `.env`、Git LFS 规则 `.gitattributes`、外部 LFS 标记 `.lfsconfig` 和 `.gitignore`。初始化可重复执行，已有文件及凭据会保留。

咔嚓的通用制作技能随 npm 包发布。项目根目录的 `AGENTS.md` 会引导 Codex 从已安装的 `@2kog/kacha/skills/` 读取技能。升级包即可更新技能。

工作台从项目的 `package.json` 读取名称和简介，从 `config/logo.*` 读取可选的项目 Logo。

## 素材存储

创作项目以 OSS 和微云为主要存储。Git 记录项目版本，Git LFS 可将图片、音频和视频原件存到 OSS。新项目的 `.gitignore` 默认忽略 `.DS_Store`、`tmp/`、`node_modules/`、`.env`、`.env.*` 和本地同步状态。常见图片、音频和视频格式由初始化生成的 `.gitattributes` 指定走 Git LFS，历史资产所在的 `archive/` 随项目保存。已有项目若单独忽略了要纳入 LFS 的媒体，需调整相应的 `.gitignore` 规则。

## 创作模板

[creative-templates/](creative-templates/) 用于收录可直接套用的创作模板，例如 3D CG 电影的风格设定和生成提示词框架。创作者可以按题材和项目要求调整模板。模板随源码维护，独立于 npm 发布包。

## 本地开发

在本仓库运行 `npm install` 安装依赖，用 `npm run dev -- /path/to/project` 启动工作台，用 `npm run build` 执行生产构建。

## Git LFS 存储设置

工作台「全局设置 → 存储设置」配置 Git LFS 上传和下载媒体所用的 OSS。保存后，咔嚓的 Git LFS 代理会读取同一份项目根目录 `.env`。也可以直接编辑 `.env`。新项目生成的五个字段均留空，默认由 `.gitignore` 排除这个文件。

```dotenv
OSS_ENDPOINT=
OSS_BUCKET=
OSS_PREFIX=
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
```

Git LFS 对象存放在配置的 Bucket 下的 `OSS_PREFIX/__kacha_lfs__/objects/`。前缀留空时使用 Bucket 根目录下的 `__kacha_lfs__/objects/`。工作台的「测试连接」会验证已保存的 OSS 配置。

## Git LFS 直连 OSS

安装 Git LFS 后，可以用 Git 管理剧本和文件指针，用阿里云 OSS 保存媒体文件。咔嚓作为 Git LFS 的本地传输代理，读取仓库根目录的 `.env`，直接上传和下载 OSS 对象。凭据留在每台电脑的 `.env`。对象写入 `OSS_PREFIX/__kacha_lfs__/objects/`，与咔嚓的项目同步版本分开。

`kacha init` 根据编码后的目录名生成 `.lfsconfig`，以 `https://kacha-lfs.invalid/<目录名>` 标识外部 LFS。实际传输目标由项目的 OSS 配置决定。常见媒体格式已在 `.gitattributes` 中登记，有其他格式时可用 `git lfs track` 补充。

创建 Git 仓库后，可在工作台保存 OSS 配置，也可直接填写项目根目录的 `.env`。首次 `git add` 媒体前，先运行 `kacha lfs setup`。该命令配置当前 Git 仓库和本地 Git LFS 钩子，并在 Git 的本地排除文件中加入 `.env` 和传输状态目录。移动咔嚓安装目录后，重新执行一次配置命令。

```bash
git init
kacha lfs setup
git add .gitattributes .lfsconfig .gitignore
```

将这三份配置提交到仓库，让同事获得同一套跟踪规则和外部存储标记。

同事第一次获取项目时，先跳过媒体下载，等本机凭据和传输代理配置好后再拉取媒体。

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone <GitHub 仓库地址>
cd <项目目录>
# 在工作台的「存储设置」保存 OSS 配置，或填写项目根目录的 .env
kacha lfs setup
git lfs pull
```

配置完成后，照常使用 `git pull` 和 `git push`。传输代理校验文件大小和 SHA-256，大文件上传分片检查点保存在本机 `.kacha/lfs-transfer/`。
