import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CompletionGlow,unreadCompletionFolders} from '../completion-glow';
import type {ExplorerResponse} from '../explorer-responses';

const response=(changes:Partial<ExplorerResponse>={}):ExplorerResponse=>({id:'binding',notePath:'App/Nested/Note.md',epoch:1,revision:1,active:false,input:false,complete:true,completionId:'turn-1',...changes});
const unread=(glow:CompletionGlow)=>[...glow.project(new Map(),()=>true).keys()];

test('completion attention survives reload and projection retirement, and clears only after focused viewing',()=>{
  let saved:unknown,writes=0;
  let glow=new CompletionGlow(undefined,value=>{saved=JSON.parse(JSON.stringify(value));writes++;});
  glow.observe([response()]);assert.deepEqual(unread(glow),['App/Nested/Note.md']);
  glow=new CompletionGlow(saved,value=>{saved=value;writes++;});
  glow.observe([response({revision:99})]);assert.equal(writes,1,'Final save revisions do not create another completion');
  glow.view('Other.md',0);glow.view('Other.md',1000);assert.equal(unread(glow).length,1);
  glow.view('App/Nested/Note.md',1000);glow.view(undefined,1600);glow.view('App/Nested/Note.md',2000);
  glow.view('App/Nested/Note.md',2700);assert.equal(unread(glow).length,1,'Hidden intervals never count');
  glow.view('App/Nested/Note.md',2800);assert.equal(unread(glow).length,0);
  glow=new CompletionGlow(saved,()=>{});glow.observe([response()]);assert.equal(unread(glow).length,0);
  glow.observe([response({completionId:'turn-2'})]);assert.equal(unread(glow).length,1,'A later run can glow again');
  glow.view('App/Nested/Note.md',3000);assert.equal(unread(glow).length,1,'A fresh completion has its own viewing interval');
});

test('only successful exact completions create attention; independent runs clear together per note',()=>{
  const glow=new CompletionGlow([{id:4}],()=>{});
  glow.observe([response({complete:false}),response({active:true}),response({input:true}),response({deleted:true})]);
  assert.deepEqual(unread(glow),[]);
  glow.observe([response(),response({id:'second'}),response({id:'other',notePath:'Other/Note.md'})]);
  assert.equal(glow.project(new Map(),()=>true).get('App/Nested/Note.md')?.unread,2);
  glow.view('App/Nested/Note.md',0);glow.view('App/Nested/Note.md',1000);
  assert.deepEqual(unread(glow),['Other/Note.md']);
});

test('folder moves preserve receipts, deletion cannot relight a recreated path, and missing notes stay unpainted',()=>{
  const glow=new CompletionGlow(undefined,()=>{});glow.observe([response()]);glow.relocate('App','Renamed');
  glow.observe([response()]);assert.deepEqual(unread(glow),['Renamed/Nested/Note.md']);
  assert.equal(glow.project(new Map(),()=>false).size,0);
  glow.relocate('Renamed');glow.observe([response()]);assert.deepEqual(unread(glow),[]);
  glow.observe([response({completionId:'another-run',notePath:'Renamed/New.md'})]);assert.deepEqual(unread(glow),['Renamed/New.md']);
});

test('unread folders use path boundaries and aggregate only outstanding notes',()=>{
  const glow=new CompletionGlow(undefined,()=>{});glow.observe([response(),response({id:'other',notePath:'Application/Note.md'})]);
  assert.deepEqual([...unreadCompletionFolders(glow.project(new Map(),()=>true))],['App/Nested','App','Application']);
});
