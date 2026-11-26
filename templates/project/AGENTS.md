# 项目工作约定

## 项目设定

读取和更新设定时，世界观及人物、地点、物件之间的关系归入 `docs/story/`，视觉风格与生成要求归入 `docs/art/`，其余项目设定归入 `docs/other/`。

## 选择制作技能

接到制作任务时，先在项目的 `node_modules/@2kog/kacha/skills/` 查看技能目录，根据各 `<技能名>/SKILL.md` 的 `description` 选择匹配的技能，再读取完整说明。项目有专属约定时，以本项目的说明为准。

使用全局安装时，通过 `npm root -g` 找到全局模块目录，再读取其中的 `@2kog/kacha/skills/`。

## 存放与更新资产

开始制作或整理前，核对资产的实际目录、现行索引、用户说明和当前引用。沿用现有分组与路径，尊重用户移动、改名和删除素材的操作。业务目录中的说明由项目维护，记录该资产的设定、用途、连续性和已确认版本。

### 分组、登记与采用

- 每项资产一个目录，根部维护 `index.json` 和 `README.md`。索引字段 `name` 为名称，`tags` 为自定义标签数组，`note` 为用户备注。素材路径相对于该资产目录，保留文件实际格式。
- 五类资产库都允许多层分组。新建分组时每层放内容为 `{}` 的 `group.json`，具体资产以根部的 `index.json` 标识。使用相对资产库根目录的完整路径区分同名资产。分组名自动成为标签，隐藏的继承标签记入 `hiddenGroupTags`。
- 新稿按用途另存。采用状态依据用户确认和资产说明填写，`candidate` 为候选，`adopted` 为已采用，`reference` 为参考。选择封面只影响展示。缺失素材保留缺项。
- 生成词只登记能与当前文件核实对应的实际输入。保留原始生成记录中的提示词、附图顺序和已知参数。发生改名或移动时，更新现行索引、说明和分镜引用，历史记录保留执行时的原文。

### 角色 · `assets/characters/`

- 新建角色时建立 `index.json`、`README.md`、`portraits/`、`skin/`、`voice/` 和 `archive/`。角色说明记录已确定的背景、外观、固定配饰、现行素材和待补项。
- 默认二维和三维三视图分别用 `2d-turnaround.<扩展名>`、`3d-turnaround.<扩展名>`，路径登记在 `image2d`、`image3d`。封面 `mainImage` 选其中一个字段名。单张立绘、探索稿按实际用途另存。独立三维模型使用单文件 GLB，路径登记在 `model3d`。
- 表情、角度和配饰特写放入 `portraits/`，可再分组。服装和造型变体直接平铺在 `skin/`，文件名区分造型、视角及 2D 或 3D 版本。
- 默认音色使用 `voice/index.<扩展名>` 并登记在 `voice` 字段。其他音色样本和角色台词放在同一目录，使用描述性文件名。
- 默认图、模型和默认音色的实际生成词存入 `prompts`，以相应索引字段名为键。特写与皮肤使用 `assetPrompts`，以文件相对于角色目录的路径为键，移动文件时同步更新键。

### 场景、道具与其他图片的共同索引

根目录用一份 `index.<扩展名>` 作为现行主图。每张图片在 `images` 中登记 `id`、`file`、`label`、`category` 和已知的 `status`。`mainImage` 指向主图条目的 ID。替换同一条目时沿用其 ID。生成词直接写入条目的 `prompt`，或用 `promptRecord` 引用资产目录内的原始 JSON，必要时用 `promptEntry` 定位其中的条目。

### 场景 · `assets/scenes/`

同一地点的机位与环境变体共用一个资产目录。需要独立维护空间连续性的地点可拆分，多个房间共用的外景或定位图保留一份并相互引用。选能说明空间关系的画面作主图。场景说明集中在资产根部的 `README.md`，记录位置、通路、朝向、固定陈设和跨机位连续性。

| 素材 | 目录 | `category` |
| --- | --- | --- |
| 机位 | `views/` | `view` |
| 时间 | `time/` | `time` |
| 天气 | `weather/` | `weather` |
| 季节 | `seasons/` | `season` |
| 空间定位 | `layout/` | `layout` |
| 局部与陈设 | `details/` | `detail` |

按需创建目录。一张图涉及多种环境条件时，在条目的 `conditions` 中按实际情况填写 `season`、`time`、`weather`。

### 道具 · `assets/props/`

同一道具的角度、状态与交付版共用一个资产目录。正侧背等角度图放 `angles/`，分类为 `angle`。细节、开合或亮灭状态及其他交付参考放 `portraits/`，分类为 `portrait`。道具说明记录剧情用途、材质、相对尺寸、握持方式和跨机位需要保持的细节。

### 其他素材 · `assets/other/`

字标、地名标识、后期叠加图形、特效和交付素材按项管理。扩展图放 `extend/`，按用途使用分类 `graphic`、`effect` 或 `delivery`。

### 可复用音频 · `assets/audio/`

音乐、音效和可复用台词按项建立目录，环境底声归音效。音频文件放 `tracks/`，索引的 `tracks` 数组登记 `id`、`file`、`label` 和 `category`，`mainTrack` 指向主音轨 ID。资产的 `type` 和音轨的 `category` 可取 `music`、`effect`、`dialogue`。用途写在资产的 `note`，音轨来源与授权写在 `source`，可循环时标记 `loop`。角色音色随角色保存。

### 替换与归档

- 首次补缺直接写入现行目录。替换现行素材、修订已有生成词或改写资产说明前，将上一版保存在该资产的 `archive/YYYY-MM-DD-vNNN/`。版本号在该资产内递增，一次修订共用一个版本。修改说明时保存旧 `README.md`。
- 角色归档保存旧 `index.json` 和本次被替换的文件，包括对应的旧生成词。特写和皮肤旧图放在版本目录根部，旧词保留在归档索引的 `assetPrompts`。现行 `history` 追加 `version`、`changes` 和 ISO 8601 格式的 `archivedAt`。
- 场景、道具和其他图片归档用版本目录内的 `index.json` 的 `images` 登记旧图及对应生成词。现行索引更新图片条目，在 `history` 追加 `version`、`note` 和 ISO 8601 格式的 `archivedAt`。
