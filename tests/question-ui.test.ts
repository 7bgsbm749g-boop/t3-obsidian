import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {EditorState} from '@codemirror/state';
import {questionUrl} from '../questions';

class Element {
  children:Element[]=[];textContent='';value='';checked=false;disabled=false;hidden=false;name='';type='';selectionStart=0;onclick?:()=>void;oninput?:()=>void;onchange?:()=>void;
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
  class Modal {contentEl=new Element();constructor(public app:any){}open(){(this as any).onOpen();}close(){(this as any).onClose();}}
  runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Modal,Notice:class{constructor(text:string){notices.push(text);}}}:realRequire(id),document:{createElement:(tag:string)=>new Element(tag)},console});
  const activities:any[]=[{id:'opened',kind:'user-input.requested',summary:'Question',turnId:'turn',payload:{requestId:'request',responseMode:'message',questions:[
    {id:'choice',header:'Choice',question:'Which one?',options:[{label:'First',description:'First description',value:'native-first'},{label:'Second',description:'Second description'}]},
    {id:'multi',header:'Multiple',question:'Which ones?',multiSelect:true,options:[{label:'A',description:'A description'},{label:'B',description:'B description'}]},
    {id:'text',header:'Text',question:'Details?',options:[]},
  ]}}];
  const sent:any[]=[],saved:any[]=[];
  const controller=new module.exports.QuestionController(async()=>({api:async(_path:string,payload?:any)=>{if(payload){sent.push(payload);return {};}return {thread:{id:'thread',activities}};}}),{load:()=>[],save:(records:any)=>{saved.push(JSON.parse(JSON.stringify(records)));}},()=> 'command');
  const modal=new module.exports.QuestionModal({},controller,target);modal.open();await controller.refresh([target]);
  return {modal,controller,sent,saved,activities,module,notices};
}

test('dialog shows descriptions and keeps drafts, input DOM, and selection through streaming refreshes',async()=>{
  const h=await harness();const form=h.modal.contentEl.children[2],inputs=form.querySelectorAll('input'),areas=form.querySelectorAll('textarea');
  assert.equal(inputs.length,4);assert.equal(inputs[0].checked,true);assert.ok(form.querySelectorAll('small').some((e:Element)=>e.textContent==='First description'));assert.equal(h.sent.length,0);
  inputs[2].checked=true;inputs[2].onchange!();inputs[3].checked=true;inputs[3].onchange!();areas[2].value='My draft';areas[2].selectionStart=3;areas[2].oninput!();
  const before=form.children.slice();await h.controller.refresh([target]);assert.deepEqual(form.children,before);assert.equal(form.querySelectorAll('textarea')[2],areas[2]);assert.equal(areas[2].value,'My draft');assert.equal(areas[2].selectionStart,3);
  h.modal.close();assert.equal(h.sent.length,0);h.modal.open();await h.controller.refresh([target]);assert.equal(h.modal.contentEl.querySelectorAll('textarea').at(-1)?.value,'My draft');
  await h.controller.submit(target);assert.equal(h.sent.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.sent[0].answers)),{choice:'native-first',multi:['A','B'],text:'My draft'});
  assert.match(h.modal.contentEl.querySelectorAll('p')[0].textContent,/Submitting/);assert.ok(h.modal.contentEl.querySelectorAll('textarea').every((e:Element)=>e.disabled));
  h.activities.push({id:'resolved',kind:'user-input.resolved',payload:{requestId:'request'}});await h.controller.refresh([target]);assert.equal(h.controller.view(target).status,'resolved');assert.equal(h.sent.length,1);
  h.modal.close();h.controller.dispose();
});

test('Live Preview replaces only question links with answer controls and leaves source mode readable',async()=>{
  const h=await harness(),text=`Before\n> [Answer](${questionUrl(target)})\nAfter`;
  const extension=h.module.exports.questionEditorExtension(h.controller,()=>{}),plugin=extension[0];
  const view=(live:boolean)=>({state:EditorState.create({doc:text}),contentDOM:{closest:()=>({classList:{contains:()=>live}})}});
  const instance=plugin.create(view(true));const ranges:string[]=[];instance.decorations.between(0,text.length,(from:number,to:number)=>{ranges.push(text.slice(from,to));});
  assert.deepEqual(ranges,[`[Answer](${questionUrl(target)})`]);assert.equal(plugin.create(view(false)).decorations.size,0);
  h.modal.close();h.controller.dispose();
});
