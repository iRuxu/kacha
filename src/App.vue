<script>
import { ElConfigProvider } from 'element-plus'
import en from 'element-plus/es/locale/lang/en'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { language } from '@/i18n/index.js'
import projectBrand from 'virtual:project-brand'

export default {
  components: { ElConfigProvider },
  computed: {
    elementLocale() {
      return language.locale === 'en' ? en : zhCn
    },
    pageTitle() {
      const page = this.$t(this.$route.meta.label || '制作工作台')
      return [page, projectBrand.name].filter(Boolean).join(' · ')
    },
  },
  watch: {
    pageTitle: {
      immediate: true,
      handler(title) {
        document.title = title
      },
    },
  },
}
</script>

<template>
  <ElConfigProvider :locale="elementLocale">
    <RouterView />
  </ElConfigProvider>
</template>
