# 音频资产

这里存放可复用的音乐、音效和台词素材。环境底声归音效，角色音色随角色放在 `voice/`。

每项资产一个目录，音频文件放 `tracks/`。用 `index.json` 的 `tracks` 登记音轨，`mainTrack` 指向主音轨的 ID。音轨条目包含 `id`、`file`、`label` 和 `category`。资产类型 `type` 和音轨分类 `category` 都可用 `music`、`effect` 或 `dialogue`。用途记在资产的 `note`，音轨来源与授权记在 `source`，可循环时标记 `loop`。
