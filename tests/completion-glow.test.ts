import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CompletionGlow,COMPLETION_READ_INTERVAL_MS,unreadCompletionFolders} from '../completion-glow';
import type {ExplorerResponse} from '../explorer-responses';

const before='2026-10-20T10:00:00.000Z',completed='2026-10-20T10:01:00.000Z',later='2026-10-20T10:02:00.000Z';
const source={environmentId:'machine',projectId:'project',threadId:'thread',runId:'run',completedAt:completed};
const response=(changes:Partial<ExplorerResponse>={}):ExplorerResponse=>({id:'binding',notePath:'App/Nested/Note.md',epoch:1,revision:1,active:false,input:false,complete:true,completionId:JSON.stringify(['message','run']),completion:{...source},...changes});
const unread=(glow:CompletionGlow)=>[...glow.project(new Map(),()=>true).keys()];
const drain=async()=>{for(let n=0;n<12;n++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(saved?:unknown){
  let now=0,reads=0,issued=0,closed=0,changed=0,writes=0,persisted:unknown=saved;
  const thread:any={id:'thread',projectId:'project',status:'completed',latestRunId:'run',latestRunCompletedAt:completed,lastVisitedAt:before};
  const threads=new Map([['machine',[thread]]]);
  const visits:Array<{environmentId:string;command:any}>=[],receipts=new Set<string>();
  let read=async(environmentId:string):Promise<any>=>({threads:structuredClone(threads.get(environmentId)??[])});
  let visit=async(environmentId:string,command:any)=>{
    if(receipts.has(command.commandId))return;
    receipts.add(command.commandId);
    const target=threads.get(environmentId)?.find(t=>t.id===command.threadId);
    if(target&&Date.parse(command.visitedAt)>Date.parse(target.lastVisitedAt))target.lastVisitedAt=command.visitedAt;
  };
  const glow=new CompletionGlow(saved,value=>{persisted=structuredClone(value);writes++;},{changed:()=>{changed++;},access:async environmentId=>{
    issued++;
    return {origin:'https://synthetic.invalid',api:async(path,command)=>{
      if(path==='/api/orchestration/shell'){reads++;return read(environmentId);}
      assert.equal(path,'/api/orchestration/dispatch');assert.equal(command.type,'thread.visit');
      visits.push({environmentId,command:structuredClone(command)});await visit(environmentId,command);
    },close:()=>{closed++;}};
  }},()=>now);
  return {glow,thread,threads,visits,read:(fn:typeof read)=>{read=fn;},visit:(fn:typeof visit)=>{visit=fn;},reads:()=>reads,issued:()=>issued,closed:()=>closed,changed:()=>changed,writes:()=>writes,saved:()=>persisted,advance:(ms=COMPLETION_READ_INTERVAL_MS)=>{now+=ms;},view:(path='App/Nested/Note.md')=>{glow.view(path,now);glow.view(path,now+800);}};
}

test('T3 owns read state across clients, reloads and retired response projections',async()=>{
  const h=fixture();h.glow.observe([response()]);await h.glow.refresh();
  assert.deepEqual(unread(h.glow),['App/Nested/Note.md']);
  h.thread.lastVisitedAt=completed;await h.glow.refresh(true);
  assert.deepEqual(unread(h.glow),[],'Reading in T3 clears Obsidian without viewing this note');
  h.thread.lastVisitedAt=before;await h.glow.refresh(true);
  assert.deepEqual(unread(h.glow),['App/Nested/Note.md'],'T3 mark-unread is authoritative too');
  const next=fixture(h.saved());await next.glow.refresh();
  assert.deepEqual(unread(next.glow),['App/Nested/Note.md'],'Only note/run identity persists after reload');
  assert.equal(JSON.stringify(h.saved()).includes('viewed'),false);
  h.glow.dispose();next.glow.dispose();await drain();assert.equal(h.closed(),1);
});

test('focused viewing acknowledges the exact completion after 750 ms and confirms the server watermark',async()=>{
  const h=fixture();h.glow.observe([response()]);await h.glow.refresh();
  h.glow.view('Other.md',0);h.glow.view('Other.md',1000);await drain();assert.equal(h.visits.length,0);
  h.glow.view('App/Nested/Note.md',1000);h.glow.view(undefined,1600);h.glow.view('App/Nested/Note.md',2000);
  h.glow.view('App/Nested/Note.md',2700);await drain();assert.equal(h.visits.length,0);
  h.glow.view('App/Nested/Note.md',2800);await drain();
  assert.equal(h.visits.length,1);assert.equal(h.visits[0].command.visitedAt,completed);assert.equal(h.thread.lastVisitedAt,completed);
  assert.deepEqual(unread(h.glow),[]);assert.equal(h.writes(),1,'Viewing never saves a local read flag');
  h.thread.lastVisitedAt=before;await h.glow.refresh(true);h.glow.view('App/Nested/Note.md',4000);await drain();
  assert.equal(h.visits.length,1,'An explicit mark-unread survives while the same view remains focused');
  h.glow.view(undefined);h.view();await drain();assert.equal(h.visits.length,2);h.glow.dispose();
});

test('visiting an older bound reply never acknowledges a newer unseen run',async()=>{
  const h=fixture();h.thread.latestRunId='new-run';h.thread.latestRunCompletedAt=later;
  h.glow.observe([response()]);await h.glow.refresh();h.view();await drain();
  assert.equal(h.visits[0].command.visitedAt,completed);
  assert.ok(Date.parse(h.thread.latestRunCompletedAt)>Date.parse(h.thread.lastVisitedAt));
  h.glow.observe([response({completionId:'new-completion',completion:{...source,runId:'new-run',completedAt:later}})]);
  assert.deepEqual(unread(h.glow),['App/Nested/Note.md']);h.glow.view('App/Nested/Note.md',1000);await drain();
  assert.equal(h.visits.length,1,'A fresh completion starts another viewing interval');h.glow.dispose();
});

test('several runs and destinations share server state and coalesce visits per thread',async()=>{
  const h=fixture();h.thread.latestRunId='later';h.thread.latestRunCompletedAt=later;
  h.glow.observe([response(),response({id:'second',completionId:'later',completion:{...source,runId:'later',completedAt:later}}),response({id:'mirror',notePath:'Other/Note.md'})]);await h.glow.refresh();
  assert.equal(h.glow.project(new Map(),()=>true).get('App/Nested/Note.md')?.unread,2);
  h.view();await drain();assert.equal(h.visits.length,1);assert.equal(h.visits[0].command.visitedAt,later);assert.deepEqual(unread(h.glow),[]);
  assert.equal(h.issued(),1,'All notes borrow one credential per machine');h.glow.dispose();
});

test('only successful exact results with supported matching server identity can glow or send a visit',async()=>{
  const h=fixture();h.glow.observe([response({complete:false}),response({active:true}),response({input:true}),response({deleted:true})]);await h.glow.refresh();
  assert.equal(h.reads(),0);assert.deepEqual(unread(h.glow),[]);
  h.glow.observe([response()]);delete h.thread.lastVisitedAt;await h.glow.refresh(true);h.view();await drain();
  assert.deepEqual(unread(h.glow),[]);assert.equal(h.visits.length,0,'Older servers never fall back to independent read flags');
  h.thread.lastVisitedAt=before;h.thread.projectId='foreign';await h.glow.refresh(true);h.view();await drain();assert.equal(h.visits.length,0);
  h.thread.projectId='project';h.thread.lastVisitedAt='invalid';await h.glow.refresh(true);assert.deepEqual(unread(h.glow),[]);h.glow.dispose();
});

test('old viewed receipts migrate through exact bindings and cannot adopt a newer run',async()=>{
  const binding:any={id:'binding',messageId:'message',threadId:'thread',projectId:'project',threadEnvironmentId:'machine'};
  const h=fixture([{id:'binding',completionId:JSON.stringify(['message','run']),notePath:'App/Nested/Note.md',viewed:true}]);
  h.glow.observe([],[binding]);await h.glow.refresh();assert.deepEqual(unread(h.glow),['App/Nested/Note.md']);
  assert.equal((h.saved() as any[])[0].completion.completedAt,completed);h.glow.dispose();
  const newer=fixture([{id:'binding',completionId:JSON.stringify(['message','old-run']),notePath:'App/Nested/Note.md',viewed:false}]);
  newer.glow.observe([],[binding]);await newer.glow.refresh();newer.view();await drain();assert.deepEqual(unread(newer.glow),[]);assert.equal(newer.visits.length,0);newer.glow.dispose();
});

test('later projections without a timestamp retain the canonical time already read for that exact run',async()=>{
  const h=fixture(),projected=response({completion:{...source,completedAt:undefined}});
  h.glow.observe([projected]);await h.glow.refresh();assert.deepEqual(unread(h.glow),['App/Nested/Note.md']);
  const writes=h.writes();h.glow.observe([projected]);await drain();
  assert.deepEqual(unread(h.glow),['App/Nested/Note.md']);assert.equal(h.writes(),writes,'A one-second repaint cannot erase and re-save the server completion time');h.glow.dispose();
});

test('offline reads keep confirmed state, failed visits retry identical commands, and newer reads win',async()=>{
  const h=fixture();h.glow.observe([response()]);await h.glow.refresh();
  h.read(async()=>{throw Error('offline');});await h.glow.refresh(true);assert.deepEqual(unread(h.glow),['App/Nested/Note.md']);
  h.visit(async()=>{throw Error('acknowledgement lost');});h.view();await drain();assert.equal(h.visits.length,1);assert.deepEqual(unread(h.glow),['App/Nested/Note.md']);
  h.glow.view('App/Nested/Note.md',1000);await drain();assert.equal(h.visits.length,1,'No retry storm while disconnected');
  h.advance();h.visit(async()=>{});h.glow.view('App/Nested/Note.md',COMPLETION_READ_INTERVAL_MS);await drain();
  assert.equal(h.visits.length,2);assert.deepEqual(h.visits[0],h.visits[1],'A lost acknowledgement reuses exact command bytes');
  assert.deepEqual(unread(h.glow),['App/Nested/Note.md'],'Dispatch acceptance alone never clears the glow');h.glow.dispose();
});

test('one refresh is shared per machine and a post-visit read follows any old in-flight read',async()=>{
  const h=fixture();h.glow.observe([response()]);await h.glow.refresh();assert.equal(h.reads(),1);
  for(let n=0;n<20;n++)h.glow.observe([response({revision:n})]);await drain();assert.equal(h.reads(),1);
  let release!:(value:any)=>void;h.advance();h.read(()=>new Promise(resolve=>{release=resolve;}));
  const old=h.glow.refresh();await drain();h.view();await drain();assert.equal(h.visits.length,1);
  h.read(async()=>({threads:[structuredClone(h.thread)]}));release({threads:[{...h.thread,lastVisitedAt:before}]});await old;await drain();
  assert.equal(h.reads(),3);assert.deepEqual(unread(h.glow),[]);h.glow.dispose();
});

test('switching notes or unloading during credential creation cannot send a visit',async()=>{
  const h=fixture();h.glow.observe([response()]);await h.glow.refresh();h.view();h.glow.view('Other.md',900);await drain();assert.equal(h.visits.length,0);
  h.glow.dispose();h.glow.observe([response()]);await h.glow.refresh(true);assert.equal(h.reads(),1);
});

test('folder moves preserve source identity and deletion cannot relight a recreated path',async()=>{
  const h=fixture();h.glow.observe([response(),response({id:'other',notePath:'Application/Note.md'})]);await h.glow.refresh();
  assert.deepEqual([...unreadCompletionFolders(h.glow.project(new Map(),()=>true))],['App/Nested','App','Application']);
  h.glow.relocate('App','Renamed');h.glow.observe([response()]);assert.deepEqual(unread(h.glow),['Renamed/Nested/Note.md','Application/Note.md']);
  assert.equal(h.glow.project(new Map(),()=>false).size,0);h.glow.relocate('Renamed');h.glow.observe([response()]);assert.deepEqual(unread(h.glow),['Application/Note.md']);h.glow.dispose();
});
