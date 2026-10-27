import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {EditorState} from '@codemirror/state';
import {ensureSyntaxTree,language} from '@codemirror/language';
import {highlightTree,classHighlighter} from '@lezer/highlight';
import {CODE_LANGUAGES,CODE_VIEW_TYPES,codeLanguage,codeReadingFence} from '../code-language';
import {grammarRuntime} from './language-grammar-runtime';
import {languageFixtures} from './fixtures/languages';

test('all 26 formats and JSX variants have a tested grammar and unambiguous extension routes',()=>{
  assert.equal(CODE_VIEW_TYPES.filter(type=>type!=='plaintext').length,26);
  assert.deepEqual(new Set(CODE_LANGUAGES.flatMap(profile=>profile.grammar?[profile.grammar]:[])),new Set(languageFixtures.map(fixture=>fixture.grammar)));
  const extensions=new Set<string>();
  for(const profile of CODE_LANGUAGES)for(const extension of profile.extensions){
    assert.equal(extensions.has(extension),false,`Duplicate extension ${extension}`);extensions.add(extension);
    assert.equal(codeLanguage(extension),profile);assert.equal(codeLanguage(extension.toUpperCase()),profile);
  }
  // C retains shared headers, Markdown stays native, unknown formats stay raw.
  assert.equal(codeLanguage('h')?.type,'c');assert.equal(codeLanguage('md'),undefined);
  assert.equal(codeLanguage('unknown')?.type,'plaintext');
});

for(const fixture of languageFixtures)test(`${fixture.name}: real grammar, token colors, raw bytes and Reading fence`,async()=>{
  const profile=codeLanguage(fixture.extension);assert.equal(profile?.type,fixture.type);assert.equal(profile?.grammar,fixture.grammar);
  const support=await (await grammarRuntime()).loadCodeGrammar(fixture.grammar);
  const state=EditorState.create({doc:fixture.raw,extensions:[EditorState.lineSeparator.of('\n'),support]});
  assert.equal(state.facet(language),support.language);assert.equal(state.doc.toString(),fixture.raw);
  const tree=ensureSyntaxTree(state,state.doc.length,5000);assert.ok(tree,'Complete fixture parsed');
  const errors:string[]=[];tree.iterate({enter:node=>{if(node.type.isError)errors.push(node.name);}});assert.deepEqual(errors,[]);
  const classes=new Set<string>();
  highlightTree(tree,classHighlighter,(_from,_to,value)=>value.split(' ').forEach(kind=>classes.add(kind)));
  for(const kind of fixture.classes)assert.ok(classes.has(kind),`${fixture.name} lacks ${kind}; got ${[...classes]}`);
  const fence=codeReadingFence(fixture.raw,profile?.grammar);
  assert.ok(fence.startsWith('```'+fixture.grammar+'\n'));assert.equal(fence.slice(fence.indexOf('\n')+1,-4),fixture.raw);
});

for(const [grammar,raw] of [
  ['html','<style>.box { content: "hello"; width: 42px; }</style>\r\n<script>const message = "hello"; const count = 42;</script>'],
  ['php','<div title="hello"><?php echo 42; ?></div>'],
] as const)test(`${grammar}: embedded languages keep their syntax colors and raw bytes`,async()=>{
  const support=await (await grammarRuntime()).loadCodeGrammar(grammar),state=EditorState.create({doc:raw,extensions:[EditorState.lineSeparator.of('\n'),support]});
  assert.equal(state.doc.toString(),raw);const tree=ensureSyntaxTree(state,state.doc.length,5000);assert.ok(tree);
  const classes=new Set<string>();highlightTree(tree,classHighlighter,(_from,_to,value)=>value.split(' ').forEach(kind=>classes.add(kind)));
  for(const kind of ['tok-keyword','tok-string','tok-number'])assert.ok(classes.has(kind),grammar+' embedded '+kind);
});

test('the native language and external-project labs bundle without a second editor runtime',async()=>{
  const external=['obsidian','electron','@electron/remote','node:*','@codemirror/state','@codemirror/view','@codemirror/language','@codemirror/commands','@codemirror/autocomplete','@lezer/common','@lezer/lr','@lezer/highlight'];
  const result=await build({stdin:{contents:"export {default as LanguageLab} from './validation/language-views-lab';export {default as CodebaseLab} from './validation/codebase-lab';",resolveDir:process.cwd()},bundle:true,write:false,metafile:true,platform:'node',format:'cjs',external});
  const inputs=Object.keys(result.metafile!.inputs);
  assert.ok(inputs.includes('language-native.ts'));assert.ok(inputs.includes('codebase-native.ts'));
  assert.equal(inputs.some(name=>/node_modules\/(?:@codemirror\/(?:state|view|language|commands|autocomplete)|@lezer\/(?:common|lr|highlight))\//.test(name)),false);
});
