import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
  {ignores:['node_modules/**','dist/**','evidence/**','release/**','scripts/**','tests/**','esbuild.config.*','eslint.config.mjs']},
  ...obsidianmd.configs.recommended,
  // These adapters are loaded only behind the checked desktop boundary. Keep
  // current-rule metadata here: older directory scanners reject inline options.
  {files:['src/**/*-desktop.ts','src/connection/desktop*.ts'],rules:{'obsidianmd/no-nodejs-modules':['warn',{isDesktopOnly:true}]}},
  {files:['src/**/*.ts'],languageOptions:{parserOptions:{projectService:true}}},
];
