import { assetWatch } from './asset-watch.js'
import { characterAssets } from './character-assets.js'
import { imageAssets } from './image-assets.js'
import { projectBrand } from './project-brand.js'
import { projectSettings } from './project-settings.js'

export function workbenchPlugins() {
  return [
    characterAssets(),
    ...['scenes', 'props', 'other', 'audio'].map(imageAssets),
    projectSettings(),
    projectBrand(),
    assetWatch(),
  ]
}
