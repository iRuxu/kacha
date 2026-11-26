import ProjectStoryboard from '@/views/scripts/ProjectStoryboard.vue'
import { createRouter, createWebHistory } from 'vue-router'
import WorkbenchLayout from '@/layouts/WorkbenchLayout.vue'
import CharacterAssets from '@/views/assets/CharacterAssets.vue'
import ImageAssets from '@/views/assets/ImageAssets.vue'
import AudioAssets from '@/views/assets/AudioAssets.vue'
import ProjectSettings from '@/views/settings/ProjectSettings.vue'
import ProjectScripts from '@/views/scripts/ProjectScripts.vue'

import ProjectHome from '@/views/home/ProjectHome.vue'

const pages = [
  { name: 'settings', group: '总览', label: '设定', icon: 'BookOpen', component: ProjectSettings },
  { name: 'characters', group: '资产', label: '角色', icon: 'Users', component: CharacterAssets },
  { name: 'scenes', group: '资产', label: '场景', icon: 'Mountain', component: ImageAssets, props: { kind: 'scenes' } },
  { name: 'props', group: '资产', label: '道具', icon: 'Box', component: ImageAssets, props: { kind: 'props' } },
  { name: 'other', group: '资产', label: '其他', icon: 'Layers3', component: ImageAssets, props: { kind: 'other' } },
  { name: 'audio', group: '资产', label: '音频', icon: 'AudioLines', component: AudioAssets },
  { name: 'scripts', group: '故事', label: '剧本', icon: 'FileText', component: ProjectScripts },
  { name: 'storyboard', group: '故事', label: '分镜', icon: 'Clapperboard', component: ProjectStoryboard },
]

const routes = [
  {
    path: '/',
    component: WorkbenchLayout,
    props: { sections: pages.map(({ name, group, label, icon }) => ({ name, group, label, icon })) },
    children: [
      { path: '', name: 'home', component: ProjectHome, meta: { group: '总览', label: '首页' } },
      ...pages.map(({ name, group, label, component, props }) => ({
        path: name,
        name,
        component,
        props,
        meta: { group, label },
      })),
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'settings' } },
]

export function createWorkbenchRouter(history = createWebHistory(import.meta.env.BASE_URL)) {
  return createRouter({ history, routes })
}
