# npm 发布

`@2kog/kacha` 通过 GitHub Actions 发布。更新 `package.json` 和 `package-lock.json` 的版本并提交，再推送相同版本的 `v<版本>` 标签。工作流会校验标签、构建并检查 npm 包内容。也可以在 Actions 中选择相同标签手动运行。

## Trusted Publishing

在 npm 包设置中添加 GitHub Actions 发布者。账号填 `iRuxu`，仓库填 `kacha`，工作流填 `publish.yml`，环境留空，开启 `Allow npm publish`。配置后按 npm 要求在两天内完成一次真实发布来验证连接。 [npm 官方文档](https://docs.npmjs.com/trusted-publishers/)

工作流的 OIDC 配置通过 `id-token: write` 获取短期凭证。使用 OIDC 发布时，工作流不能读取发布用的 `NPM_TOKEN`。确认 OIDC 发版成功后，可从 GitHub Actions Secrets 清理首发使用的 token。
