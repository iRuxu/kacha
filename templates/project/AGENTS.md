# 咔嚓技能

接到制作任务时，先在项目的 `node_modules/@2kog/kacha/skills/` 查看技能目录，根据各 `<技能名>/SKILL.md` 的 `description` 选择匹配的技能，再读取完整说明。项目有专属约定时，以本项目的说明为准。

使用全局安装时，通过 `npm root -g` 找到全局模块目录，再读取其中的 `@2kog/kacha/skills/`。

# 资产管理约定

| 资产 | 目录 |
| --- | --- |
| 角色 | [assets/characters/](assets/characters/README.md) |
| 场景 | [assets/scenes/](assets/scenes/README.md) |
| 道具 | [assets/props/](assets/props/README.md) |
| 其他素材 | [assets/other/](assets/other/README.md) |
| 音频 | [assets/audio/](assets/audio/README.md) |

- 每项资产用独立目录。资产根目录放 `index.json` 和 `README.md`，名称、标签和备注分别写入索引的 `name`、`tags`、`note`。制作说明写入 README，素材引用使用相对于资产目录的路径。
- 需要分组时，每层分组用内容为 `{}` 的 `group.json` 标记，例如 `assets/props/宫廷/服饰/龙纹玉佩/` 的「宫廷」和「服饰」。同库内按完整相对路径区分同名资产。分组名会继承为标签，可用 `hiddenGroupTags` 隐藏指定继承标签。
- 场景、道具和其他图片用 `images` 登记。条目包含 `id`、`file`、`label`、`category` 和已知的 `status`，`mainImage` 指向主图条目的 ID。实际生成词写入条目的 `prompt`，或通过 `promptRecord` 和可选的 `promptEntry` 引用。标记为采用前，先确认用户已选定该版本。
- 替换现行素材、修订已有生成词或资产说明前，把上一版保存到该资产的 `archive/YYYY-MM-DD-vNNN/`，并在索引的 `history` 登记。移动或改名时同步更新当前索引及相关引用。

## Git LFS 存储

项目用 Git LFS 管理媒体时，在工作台「全局设置 → 存储设置」填写该项目的 OSS 目标。配置保存在项目本地的 `.env`，随 Git 推送或拉取的媒体通过咔嚓代理直连 OSS。首次配置步骤见[项目 README](README.md)。
