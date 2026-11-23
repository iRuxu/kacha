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
