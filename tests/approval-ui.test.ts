import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {EditorState} from '@codemirror/state';
import {approvalUrl,renderApproval} from '../approvals';

const target={environmentId:'env',threadId:'thread',requestId:'request'};
class Element {
  textContent='';disabled=false;title='';events:Record<string,Function>={};attributes:Record<string,string>={};
  addEventListener(name:string,callback:Function){this.events[name]=callback;}
  setAttribute(name:string,value:string){this.attributes[name]=value;}
  click(){if(!this.disabled)this.events.click({preventDefault(){},stopPropagation(){}});}
}
async function harness(){
  const result=await build({stdin:{contents:"export * from './approval-ui'; export * from './approval-controller';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian','@codemirror/state','@codemirror/view']});
  const module={exports:{} as any},realRequire=createRequire(import.meta.url),notices:string[]=[];
  runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Notice:class{constructor(text:string){notices.push(text);}}}:realRequire(id),document:{createElement:()=>new Element()},console});
  const activities:any[]=[{id:'opened',kind:'approval.requested',summary:'Command approval requested',turnId:'turn',payload:{requestId:'request',requestKind:'command',detail:'printf hello'}}];
  const sent:any[]=[];let fail=false;
  const controller=new module.exports.ApprovalController(async()=>({api:async(_path:string,payload?:any)=>{if(payload){sent.push(payload);if(fail)throw Error('Lost acknowledgement');return {};}return {thread:{id:'thread',activities}};}}),{load:()=>[],save:()=>{}},()=> 'command');
  return {module,controller,activities,sent,notices,fail:()=>{fail=true;}};
}

test('buttons send only the chosen decision, lock on acknowledgement and resolve on external confirmation',async()=>{
  const h=await harness(),approve=h.module.exports.approvalButton(h.controller,target,'accept'),deny=h.module.exports.approvalButton(h.controller,target,'decline');
  assert.equal(approve.button.disabled,true);assert.equal(deny.button.disabled,true);
  // Projected controls may have no saved note text. Mounting must fetch their request itself.
  for(let attempt=0;approve.button.disabled&&attempt<50;attempt++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(approve.button.disabled,false);assert.equal(deny.button.disabled,false);assert.equal(h.sent.length,0);assert.equal(h.controller.watchedTargets().length,1);
  deny.button.click();await h.controller.submit(target,'decline');
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].decision,'decline');assert.equal(deny.button.textContent,'Sending…');assert.equal(approve.button.disabled,true);assert.equal(deny.button.disabled,true);
  h.activities.push({id:'resolved',kind:'approval.resolved',payload:{requestId:'request'}});await h.controller.refresh([target]);
  assert.equal(approve.button.textContent,'Resolved');assert.equal(approve.button.disabled,true);assert.equal(deny.button.disabled,true);
  approve.unsubscribe();assert.equal(h.controller.watchedTargets().length,1);deny.unsubscribe();assert.equal(h.controller.watchedTargets().length,0);h.controller.dispose();
});

test('lost acknowledgement offers only the saved decision as a retry',async()=>{
  const h=await harness(),approve=h.module.exports.approvalButton(h.controller,target,'accept'),deny=h.module.exports.approvalButton(h.controller,target,'decline');
  await h.controller.refresh([target]);h.fail();approve.button.click();await assert.rejects(h.controller.submit(target,'accept'),/Lost acknowledgement/);
  assert.equal(approve.button.textContent,'Retry approve');assert.equal(approve.button.disabled,false);assert.equal(deny.button.disabled,true);assert.match(approve.button.title,/Retry/);
  assert.equal(h.notices.length,1);approve.unsubscribe();deny.unsubscribe();h.controller.dispose();
});

test('Live Preview controls are inline and exclude fenced examples; source mode retains Markdown',async()=>{
  const h=await harness(),section=renderApproval({requestId:'request',turnId:'turn',kind:'command',summary:'Command approval requested',detail:'printf hello'},target),text=section+'\n\n```text\n'+section+'\n```';
  const extension=h.module.exports.approvalEditorExtension(h.controller),plugin=extension[0];
  const view=(live:boolean)=>({state:EditorState.create({doc:text}),contentDOM:{closest:()=>({classList:{contains:()=>live}})}});
  const instance=plugin.create(view(true)),ranges:string[]=[];instance.decorations.between(0,text.length,(from:number,to:number)=>ranges.push(text.slice(from,to)));
  assert.deepEqual(ranges,[`[Approve](${approvalUrl(target,'accept')})`,`[Deny](${approvalUrl(target,'decline')})`]);
  assert.equal(plugin.create(view(false)).decorations.size,0);h.controller.dispose();
});
