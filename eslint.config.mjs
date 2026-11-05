import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
  {ignores:['node_modules/**','dist/**','evidence/**','release/**','scripts/**','tests/**','esbuild.config.*','eslint.config.mjs']},
  ...obsidianmd.configs.recommended,
  {files:['src/**/*.ts'],languageOptions:{parserOptions:{projectService:true}}},
];
