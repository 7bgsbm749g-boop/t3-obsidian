import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codeLanguage,nativeLanguageVersion,plainTransfer,codeReadingFence,CodeGrammarCache,rawCodeChange,codeTabSize} from '../code-language';
test('raw changes preserve mixed line endings, whitespace and Unicode',()=>{
  for(const [before,after] of [['','\tnew\r\n'],['same','same'],['\told\r\n  next\n','\tnew\r\n  next\n'],['alpha\r\nbeta','alpha\r\n  beta'],['😀 x','😁 x'],['removed','']]){
    const change=rawCodeChange(before,after);assert.equal(change?before.slice(0,change.from)+change.insert+before.slice(change.to):before,after);
  }
  assert.equal(rawCodeChange('same','same'),undefined);
  assert.deepEqual(rawCodeChange('a\r\nb','a\r\nc'),{from:3,to:4,insert:'c'});
  for(const size of [1,2,4,8,16])assert.equal(codeTabSize(size),size);
  for(const size of [0,17,-1,2.5,'8',undefined])assert.equal(codeTabSize(size),4);
});
test('code routing selects JSX variants and leaves Markdown native',()=>{
  assert.equal(codeLanguage('md'),undefined);assert.equal(codeLanguage('MD'),undefined);
  for(const extension of ['ts','mts','cts','TS'])assert.deepEqual(codeLanguage(extension),{type:'typescript',grammar:'typescript',extensions:['ts','mts','cts']});
  assert.equal(codeLanguage('tsx')?.type,'typescript');assert.equal(codeLanguage('tsx')?.grammar,'tsx');
  assert.equal(codeLanguage('jsx')?.type,'javascript');assert.equal(codeLanguage('jsx')?.grammar,'jsx');
  assert.equal(codeLanguage('mjs')?.grammar,'javascript');assert.equal(codeLanguage('pyw')?.grammar,'python');
  assert.equal(codeLanguage('json')?.grammar,'json');assert.equal(codeLanguage('css')?.grammar,'css');assert.equal(codeLanguage('log')?.type,'plaintext');
});
test('native version guard covers tested editor families and rejects unknown versions',()=>{
  for(const version of ['1.13.7','1.13.8','1.14.0','1.14.4'])assert.equal(nativeLanguageVersion(version),true,version);
  for(const version of ['1.13.6','1.12.9','1.15.0','2.0.0','','unavailable','1.14'])assert.equal(nativeLanguageVersion(version),false,version);
});
test('nontext transfers preserve selections while explicit plain text stays exact',()=>{
  assert.equal(plainTransfer(null),undefined);
  assert.equal(plainTransfer({types:['text/html','image/png'],getData:()=> 'wrong'}),undefined);
  assert.equal(plainTransfer({types:['text/plain','text/html'],getData:()=> 'https://example.invalid/raw?q=1'}),'https://example.invalid/raw?q=1');
  assert.equal(plainTransfer({types:['text/plain'],getData:()=> ''}),'');
});
test('reading fences cannot close inside raw code and preserve input bytes',()=>{
  for(const raw of ['', 'const x = 1;', 'const x = 1;\n','```\n# not Markdown\n```','const raw = "'+ '`'.repeat(120000)+'";']){
    const rendered=codeReadingFence(raw,'typescript'),delimiter=rendered.slice(0,rendered.indexOf('typescript'));
    assert.ok(delimiter.length>=3);assert.equal(raw.includes(delimiter),false);
    assert.equal(rendered.slice(delimiter.length+'typescript\n'.length,-delimiter.length),raw+(raw.endsWith('\n')?'':'\n'));
  }
  assert.equal(codeReadingFence('raw'), '```\nraw\n```');
});
test('grammar initialization is lazy, cached and coalesces concurrent opens',async()=>{
  let loads=0,finish!:(value:object)=>void;const cache=new CodeGrammarCache(async()=>{loads++;return new Promise<object>(resolve=>{finish=resolve;});});
  assert.equal(loads,0);const first=cache.get('typescript'),second=cache.get('typescript');assert.equal(first,second);await Promise.resolve();assert.equal(loads,1);
  const value={grammar:'typescript'};finish(value);assert.equal(await first,value);assert.equal(await cache.get('typescript'),value);assert.equal(loads,1);
});
test('failed grammar loads permit a later retry without duplicating successful loads',async()=>{
  let loads=0;const cache=new CodeGrammarCache(async()=>{if(++loads===1)throw Error('unavailable');return 'ready';});
  await assert.rejects(cache.get('python'),/unavailable/);assert.equal(await cache.get('python'),'ready');assert.equal(await cache.get('python'),'ready');assert.equal(loads,2);
});
