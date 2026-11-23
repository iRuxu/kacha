# 创作项目

在项目根目录运行 `npx kacha`，打开 http://127.0.0.1:24074 浏览和管理资产。

资产集中在 `assets/`，目录与索引约定见 [AGENTS.md](AGENTS.md)。工作台从根目录的 `package.json` 读取项目名称和简介，可填写 `name` 和 `description`。

## Git LFS 与 OSS

工作台的「全局设置 → 存储设置」用于配置 Git LFS 上传和下载媒体的 OSS 目标。保存后，工作台与 Git LFS 代理共用项目根目录的 `.env`。初始化时会生成 `.env`，其中 `OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_PREFIX`、`OSS_ACCESS_KEY_ID` 和 `OSS_ACCESS_KEY_SECRET` 均留空。已有 `.env` 会保留。`.env` 由 Git 忽略规则排除。

LFS 对象保存在配置的 Bucket 下的 `OSS_PREFIX/__kacha_lfs__/objects/`。前缀留空时使用 `__kacha_lfs__/objects/`。工作台可测试已保存的 OSS 配置，旧版云朵同步入口已隐藏。

`kacha init` 会生成 `.gitattributes`，为常见图片、音频和视频配置 Git LFS 规则。生成的 `.lfsconfig` 以 `https://kacha-lfs.invalid/<编码后的目录名>` 标识外部 LFS，实际传输目标取自项目的 OSS 配置。常见视频可按规则纳入 Git LFS，历史资产所在的 `archive/` 随项目保存。已有项目若单独忽略了要纳入 LFS 的媒体，需调整相应的 `.gitignore` 规则。

初始化 Git 仓库并保存本机 OSS 配置后，在首次 `git add` 媒体前运行 `kacha lfs setup`。将 `.gitattributes`、`.lfsconfig` 和 `.gitignore` 随项目提交。后续通过 `git push` 将媒体直传 OSS，通过 `git pull` 获取团队更新。首次克隆时可用 `GIT_LFS_SKIP_SMUDGE=1 git clone`，完成本机设置后执行 `git lfs pull` 下载媒体。
