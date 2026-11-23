<script>
import { ElOption, ElSelect } from 'element-plus'
import 'element-plus/es/components/select/style/css'
import { AudioLines, BookOpen, Box, ChevronRight, Globe, Layers3, Mountain, Users } from 'lucide-vue-next'
import projectBrand from 'virtual:project-brand'
import { language, languages } from '@/i18n/index.js'

export default {
  components: { AudioLines, BookOpen, Box, ChevronRight, ElOption, ElSelect, Globe, Layers3, Mountain, Users },
  props: { sections: { type: Array, required: true } },
  data() {
    return {
      language,
      languages,
      projectLogo: projectBrand.logo,
    }
  },
  computed: {
    projectName() {
      return projectBrand.name || this.$t('制作项目')
    },
    projectDescription() {
      return projectBrand.description || this.$t('制作工作台')
    },
  },
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-icon"><img v-if="projectLogo" :src="projectLogo" alt="" @error="projectLogo = ''" /><span v-else class="brand-rabbit" aria-hidden="true"></span></span><div><strong>{{ projectName }}</strong><small>{{ projectDescription }}</small></div></div>
      <nav :aria-label="$t('工作台')">
        <template v-for="(item, index) in sections" :key="item.name">
          <div v-if="item.group !== sections[index - 1]?.group" class="nav-title">{{ $t(item.group) }}</div>
          <RouterLink class="nav-link" :class="{ 'settings-nav': item.name === 'settings' }"
            :to="{ name: item.name }" exact-active-class="selected">
            <component :is="item.icon" :size="17" />{{ $t(item.label, {}, 'navigation') }}<ChevronRight class="nav-arrow" :size="14" />
          </RouterLink>
        </template>
      </nav>
    </aside>

    <main>
      <header class="topbar">
        <span>{{ $t($route.meta.group) }}</span>
        <ChevronRight :size="14" aria-hidden="true" />
        <strong>{{ $t($route.meta.label) }}</strong>
        <ElSelect v-model="language.locale" class="language-control" popper-class="language-options" :aria-label="$t('语言')">
          <template #prefix><Globe :size="15" aria-hidden="true" /></template>
          <ElOption v-for="(label, locale) in languages" :key="locale" :value="locale" :label="label" :lang="locale" />
        </ElSelect>
      </header>
      <RouterView v-slot="{ Component, route }">
        <KeepAlive include="CharacterAssets">
          <component :is="Component" :key="route.name" />
        </KeepAlive>
      </RouterView>
    </main>
  </div>
</template>
