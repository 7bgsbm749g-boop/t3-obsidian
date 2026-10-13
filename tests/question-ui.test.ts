import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {EditorState} from '@codemirror/state';
import {questionUrl,renderQuestion,pendingQuestions} from '../questions';
import {projectResponses,responseAnchor} from '../native-response-projection';

class Element {
  children:Element[]=[];textContent='';value='';checked=false;disabled=false;hidden=false;name='';type='';selectionStart=0;dataset:Record<string,string>={};onclick?:()=>void;oninput?:()=>void;onchange?:()=>void;onfocus?:()=>void;
  constructor(public tag='div',public options:any={}){this.textContent=options.text??'';this.type=options.type??'';}
  addClass(){} addEventListener(){} empty(){this.children=[];}replaceChildren(){this.children=[];}
  createEl(tag:string,options?:any){const child=new Element(tag,options);this.children.push(child);return child;}
  createDiv(options?:any){return this.createEl('div',options);}
  querySelectorAll(selector:string):Element[]{return this.children.flatMap(child=>[...(selector.split(',').includes(child.tag)?[child]:[]),...child.querySelectorAll(selector)]);}
}
const target={environmentId:'environment',threadId:'thread',requestId:'request'};
async function harness(){
  const result=await build({stdin:{contents:"export * from './question-ui'; export * from './question-controller';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian','@codemirror/state','@codemirror/view']});
  const module={exports:{} as any},realRequire=createRequire(import.meta.url),notices:string[]=[];
  class Modal {contentEl=new Element();isOpen=false;closeCount=0;constructor(public app:any){}open(){this.isOpen=true;(this as any).onOpen();}close(){this.app.restoreFocus?.();this.isOpen=false;this.closeCount++;(this as any).onClose();}}
  runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Modal,Notice:class{constructor(text:string){notices.push(text);}}}:realRequire(id),document:{createElement:(tag:string)=>new Element(tag)},console,setTimeout,clearTimeout,AbortController,DOMException});
  const activities:any[]=[{id:'opened',kind:'user-input.requested',summary:'Question',turnId:'turn',payload:{requestId:'request',responseMode:'message',questions:[
    {id:'choice',header:'Choice',question:'Which one?',options:[{label:'First',description:'First description',value:'native-first'},{label:'Second',description:'Second description'}]},
    {id:'multi',header:'Multiple',question:'Which ones?',multiSelect:true,options:[{label:'A',description:'A description'},{label:'B',description:'B description'}]},
    {id:'text',header:'Text',question:'Details?',options:[]},
  ]}}];
  const sent:any[]=[],saved:any[]=[];let dispatchError=false;
  const controller=new module.exports.QuestionController(async()=>({api:async(_path:string,payload?:any)=>{if(payload){sent.push(payload);if(dispatchError)throw Error('Connection lost');return {};}return {thread:{id:'thread',activities}};}}),{load:()=>[],save:(records:any)=>{saved.push(JSON.parse(JSON.stringify(records)));}},()=> 'command');
  const modal=new module.exports.QuestionModal({},controller,target);modal.open();await controller.refresh([target]);
  return {modal,controller,sent,saved,activities,module,notices,failDispatch:()=>{dispatchError=true;}};
}

test('dialog shows descriptions and keeps drafts, input DOM, and selection through streaming refreshes',async()=>{
  const h=await harness();const form=h.modal.contentEl.children[2],inputs=form.querySelectorAll('input'),areas=form.querySelectorAll('textarea');
  assert.equal(inputs.length,4);assert.equal(inputs[0].checked,true);assert.ok(form.querySelectorAll('small').some((e:Element)=>e.textContent==='First description'));assert.equal(h.sent.length,0);
  inputs[2].checked=true;inputs[2].onchange!();inputs[3].checked=true;inputs[3].onchange!();areas[2].value='My draft';areas[2].selectionStart=3;areas[2].oninput!();
  const before=form.children.slice();await h.controller.refresh([target]);assert.deepEqual(form.children,before);assert.equal(form.querySelectorAll('textarea')[2],areas[2]);assert.equal(areas[2].value,'My draft');assert.equal(areas[2].selectionStart,3);
  h.modal.close();assert.equal(h.sent.length,0);h.modal.open();await h.controller.refresh([target]);assert.equal(h.modal.contentEl.querySelectorAll('textarea').at(-1)?.value,'My draft');
  await h.controller.submit(target);assert.equal(h.sent.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.sent[0].answers)),{choice:'native-first',multi:['A','B'],text:'My draft'});
  assert.match(h.modal.contentEl.querySelectorAll('p')[0].textContent,/Answer sent/);assert.ok(h.modal.contentEl.querySelectorAll('textarea').every((e:Element)=>e.disabled));
  assert.equal(h.modal.isOpen,true,'dispatch acknowledgement alone must not close the dialog');
  h.activities.push({id:'resolved',kind:'user-input.resolved',payload:{requestId:'request',answers:{text:'My draft'}}});await h.controller.refresh([target]);assert.equal(h.controller.view(target).status,'resolved');assert.equal(h.sent.length,1);
  assert.equal(h.modal.isOpen,false);assert.equal(h.modal.contentEl.children.length,0);assert.ok(h.notices.includes('T3 question resolved.'));
  h.modal.close();h.controller.dispose();
});

test('Dismiss closes synchronously and hides the whole question in native projection and source mode before remote reads finish',async()=>{
  const h=await harness(),section=renderQuestion(pendingQuestions(h.activities)[0],target),id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const projection=projectResponses('Before\n'+responseAnchor(id)+'\nAfter',[{id,body:'> Retained answer\n\n'+section}]);
  const extension=h.module.exports.questionEditorExtension(h.controller,()=>{}),field=extension[2];
  let state=EditorState.create({doc:projection.display,extensions:[field]}),reads=0;
  const subscription=extension[3].create({dispatch:(spec:any)=>{state=state.update(spec).state;}});
  h.controller.access=()=>{reads++;return new Promise(()=>{});};
  assert.equal(state.field<any>(field).size,0);
  const button=h.modal.contentEl.querySelectorAll('button').find((el:Element)=>el.textContent==='Dismiss')!;button.onclick!();
  assert.equal(h.modal.isOpen,false);assert.equal(h.controller.isDismissed(target),true);assert.equal(state.field<any>(field).size,1);
  const hidden:string[]=[];state.field<any>(field).between(0,state.doc.length,(from:number,to:number)=>hidden.push(state.doc.sliceString(from,to)));assert.deepEqual(hidden,[section]);
  assert.equal(state.doc.toString(),projection.display,'Keep saved anchors and live writer hashes intact');
  state=state.update({changes:{from:0,insert:'New outside edit\n'}}).state;assert.equal(state.field<any>(field).size,1,'A new projection cannot restore dismissed controls');
  assert.ok(h.saved.at(-1)[0].dismissed);assert.equal(h.sent.length,0);assert.ok(h.notices.includes('T3 question dismissed.'));
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(reads,1);subscription.destroy();h.controller.dispose();
});

test('external resolution closes the dialog once while failed submission preserves its draft',async()=>{
  const h=await harness();const areas=h.modal.contentEl.querySelectorAll('textarea'),inputs=h.modal.contentEl.querySelectorAll('input');areas[2].value='Saved draft';areas[2].oninput!();inputs[2].checked=true;inputs[2].onchange!();
  h.failDispatch();await assert.rejects(h.controller.submit(target),/Connection lost/);assert.equal(h.modal.isOpen,true);assert.equal(areas[2].value,'Saved draft');
  h.activities.push({id:'failed',kind:'provider.user-input.respond.failed',payload:{requestId:'request',detail:'Provider unavailable'}});
  await h.controller.refresh([target]);assert.equal(h.modal.isOpen,true);assert.equal(areas[2].value,'Saved draft');
  h.activities.push({id:'external',kind:'user-input.resolved',payload:{requestId:'request'}});
  await h.controller.refresh([target]);assert.equal(h.modal.isOpen,false);assert.equal(h.sent.length,1);
  await h.controller.refresh([target]);assert.equal(h.modal.closeCount,1);h.controller.dispose();
});

test('Live Preview replaces only question links with answer controls and leaves source mode readable',async()=>{
  const h=await harness(),text=`Before\n> [Answer](${questionUrl(target)})\nAfter`;
  const extension=h.module.exports.questionEditorExtension(h.controller,()=>{}),plugin=extension[0];
  const view=(live:boolean)=>({state:EditorState.create({doc:text}),contentDOM:{closest:()=>({classList:{contains:()=>live}})}});
  const instance=plugin.create(view(true));const ranges:string[]=[];instance.decorations.between(0,text.length,(from:number,to:number)=>{ranges.push(text.slice(from,to));});
  assert.deepEqual(ranges,[`[Answer](${questionUrl(target)})`]);assert.equal(plugin.create(view(false)).decorations.size,0);
  h.modal.close();h.controller.dispose();
});

test('closing a resolved dialog preserves editor scroll while Obsidian restores focus',async()=>{
  const h=await harness();let scroll={top:800,left:12};
  h.modal.app.workspace={getLeavesOfType:()=>[{view:{editor:{getScrollInfo:()=>({...scroll}),scrollTo:(left:number,top:number)=>{scroll={left,top};}}}}]};
  h.modal.app.restoreFocus=()=>{scroll={top:0,left:0};};
  h.activities.push({id:'resolved',kind:'user-input.resolved',payload:{requestId:'request'}});
  await h.controller.refresh([target]);assert.equal(h.modal.isOpen,false);assert.deepEqual(scroll,{top:800,left:12});h.controller.dispose();
});

test('choosing an option preserves the inactive custom draft across refresh and reopening',async()=>{
  const h=await harness();let areas=h.modal.contentEl.querySelectorAll('textarea'),inputs=h.modal.contentEl.querySelectorAll('input');
  areas[0].value='Keep this custom answer';areas[0].oninput!();
  assert.equal(areas[0].dataset.answerActive,'true');assert.ok(!inputs[0].checked);
  inputs[1].checked=true;inputs[1].onchange!();
  assert.equal(areas[0].value,'Keep this custom answer');assert.equal(areas[0].dataset.answerActive,'false');
  assert.match(h.modal.contentEl.querySelectorAll('small').map((el:Element)=>el.textContent).join(' '),/selected option will be submitted/);
  await h.controller.refresh([target]);assert.equal(areas[0].value,'Keep this custom answer');
  h.modal.close();h.modal.open();await h.controller.refresh([target]);
  areas=h.modal.contentEl.querySelectorAll('textarea');inputs=h.modal.contentEl.querySelectorAll('input');
  assert.equal(areas[0].value,'Keep this custom answer');assert.equal(areas[0].dataset.answerActive,'false');assert.equal(inputs[1].checked,true);
  areas[0].onfocus!();assert.equal(areas[0].dataset.answerActive,'true');assert.ok(!inputs[1].checked);
  inputs[1].checked=true;inputs[1].onchange!();
  areas[2].value='Details';areas[2].oninput!();inputs[2].checked=true;inputs[2].onchange!();
  await h.controller.submit(target);assert.equal(h.sent[0].answers.choice,'Second');
  assert.equal(areas[0].value,'Keep this custom answer','Only the active answer is submitted; the draft remains visible');
  h.modal.close();h.controller.dispose();
});

test('ordinary typing maps dismissed ranges and status updates do not send editor transactions',async()=>{
  const h=await harness();
  const section=renderQuestion(pendingQuestions(h.activities)[0],target),extension=h.module.exports.questionEditorExtension(h.controller,()=>{}),field=extension[2];
  let state=EditorState.create({doc:'Synthetic prose '.repeat(30000)+'\n'+section,extensions:[field]}),updates=0;
  const subscription=extension[3].create({dispatch:(spec:any)=>{updates++;state=state.update(spec).state;}});
  h.controller.record(target).dismissed=true;
  await h.controller.refresh([target]);assert.equal(updates,1);assert.equal(state.field<any>(field).size,1);
  for(let i=0;i<20;i++)state=state.update({changes:{from:100,insert:'x'}}).state;
  const ranges:string[]=[];state.field<any>(field).between(0,state.doc.length,(from:number,to:number)=>ranges.push(state.doc.sliceString(from,to)));assert.deepEqual(ranges,[section]);
  await h.controller.refresh([target]);assert.equal(updates,1,'no dismissal changes, no editor transaction');
  subscription.destroy();h.modal.close();h.controller.dispose();
});
