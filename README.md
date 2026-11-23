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
├── .gitignore
├── AGENTS.md
├── README.md
└── assets/
    ├── characters/
    ├── scenes/
    ├── props/
    ├── other/
    └── audio/
```

每个资产库附有目录说明。单项资产用 `index.json` 登记元数据，用 `README.md` 记录制作说明。需要分组时，可在每层分组目录放置 `group.json`。初始化可重复执行，已有文件会保留。

工作台从项目的 `package.json` 读取名称和简介，从 `config/logo.*` 读取可选的项目 Logo。

## 素材存储

创作项目以 OSS 和微云为主要存储。Git 用于记录现行采用的资产和说明。新项目的 `.gitignore` 默认忽略任意层级的 `archive/`、常见视频文件和本地依赖，项目可按需要追加规则。OSS 和微云的配置方式将在后续补充。

## 创作模板

[creative-templates/](creative-templates/) 用于收录可直接套用的创作模板，例如 3D CG 电影的风格设定和生成提示词框架。创作者可以按题材和项目要求调整模板。模板随源码维护，独立于 npm 发布包。

## 本地开发

在本仓库运行 `npm install` 安装依赖，用 `npm run dev -- /path/to/project` 启动工作台，用 `npm run build` 执行生产构建。
