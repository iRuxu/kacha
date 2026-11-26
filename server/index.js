import { projectStoryboard } from './project-storyboard.js'
import { assetWatch } from './asset-watch.js'
import { characterAssets } from './character-assets.js'
import { imageAssets } from './image-assets.js'
import { projectGlobal } from './project-global.js'
import { projectBrand } from './project-brand.js'
import { projectOssSync } from './project-oss-sync.js'
import { projectStorage } from './project-storage.js'
import { projectSettings } from './project-settings.js'
import { projectScripts } from './project-scripts.js'

export function workbenchPlugins() {
  return [
    characterAssets(),
    ...['scenes', 'props', 'other', 'audio'].map(imageAssets),
    projectSettings(),
    projectScripts(),
    projectStoryboard(),
    projectBrand(),
    projectGlobal(),
    projectStorage(),
    projectOssSync(),
    assetWatch(),
  ]
}
