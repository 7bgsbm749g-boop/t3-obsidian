import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
  {ignores:['node_modules/**','dist/**','evidence/**','release/**','scripts/**','tests/**','esbuild.config.*','eslint.config.mjs']},
  ...obsidianmd.configs.recommended,
  {files:['src/**/*.ts'],languageOptions:{parserOptions:{projectService:true}},rules:{
    // The directory scanner also checks thenable Obsidian controls returned
    // from void callbacks, which the SDK-aware replacement rule permits.
    '@typescript-eslint/no-misused-promises':'error',
    '@typescript-eslint/no-unnecessary-type-assertion':'error',
  }},
];
