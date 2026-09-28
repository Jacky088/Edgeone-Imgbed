import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
import { configureVueProject } from '@vue/eslint-config-typescript'
configureVueProject({ scriptLangs: ['ts', 'tsx', 'js'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue,js}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  skipFormatting,
  {
    name: 'app/project-rules',
    rules: {
      // UI 基础组件（Button/Progress）与测试内 require 均为刻意写法，关闭误报
      'vue/multi-word-component-names': 'off',
      // EdgeOne 环境下 Express req/res 无完整类型可用，项目历史即用 any
      '@typescript-eslint/no-explicit-any': 'off',
      // 未使用参数（如错误处理 catch (e)、Express next 占位）不视为错误
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
)
