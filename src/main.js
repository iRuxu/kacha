import { createApp } from 'vue'
import { i18n } from '@/i18n/index.js'
import App from './App.vue'
import { createWorkbenchRouter } from './router/index.js'
import '@/assets/css/workbench.css'

createApp(App).use(i18n).use(createWorkbenchRouter()).mount('#app')
