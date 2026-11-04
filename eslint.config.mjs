import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
  {ignores:['node_modules/**','dist/**','evidence/**','release/**','scripts/**','tests/**','esbuild.config.*','eslint.config.mjs']},
  ...obsidianmd.configs.recommended,
  // The user explicitly chose this exact public description. Keep structural
  // manifest validation and every other word/format check enabled.
  {files:['manifest.json'],rules:{'obsidianmd/validate-manifest':['warn',{allowedWords:{description:['obsidian']}}]}},
  {files:['src/**/*.ts'],languageOptions:{parserOptions:{projectService:true}}},
];
