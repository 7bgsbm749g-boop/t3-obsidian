import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installMobileSelectionAction} from '../mobile-selection-action';

class Events {
  listeners=new Map<string,Set<(event?:any)=>void>>();
  addEventListener(name:string,callback:(event?:any)=>void){let set=this.listeners.get(name);if(!set)this.listeners.set(name,set=new Set());set.add(callback);}
  removeEventListener(name:string,callback:(event?:any)=>void){this.listeners.get(name)?.delete(callback);}
  emit(name:string,event?:any){for(const callback of this.listeners.get(name)??[])callback(event);}
}

test('mobile Ask T3 action appears only for the active editor selection and preserves it on tap',async()=>{
  const oldDocument=globalThis.document,oldWindow=globalThis.window;
  const dom=new Events(),browser=new Events();
  const button=Object.assign(new Events(),{type:'',className:'',textContent:'',hidden:false,style:{} as Record<string,string>,offsetWidth:82,offsetHeight:38,attributes:{} as Record<string,string>,removed:false,
    setAttribute(name:string,value:string){this.attributes[name]=value;},remove(){this.removed=true;}});
  let selectionText='',active:any;
  const node={};
  const editor={getSelection:()=>selectionText};
  const view={file:{path:'Notes/Question.md',extension:'md'},editor,contentEl:{contains:(candidate:any)=>candidate===node},getMode:()=> 'source'};
  active=view;
  const native={isCollapsed:false,anchorNode:node,rangeCount:1,getRangeAt:()=>({getClientRects:()=>[{left:100,right:250,top:200,bottom:230,width:150,height:30}]})};
  Object.assign(dom,{createElement:()=>button,body:{appendChild:()=>{} }});
  Object.assign(browser,{getSelection:()=>native,innerWidth:400,innerHeight:700,visualViewport:undefined});
  Object.assign(globalThis,{document:dom,window:browser});
  const events=new Events(),asked:any[]=[];
  const app={workspace:{on:(name:string,callback:()=>void)=>{events.addEventListener(name,callback);return {name,callback};},offref:(ref:any)=>events.removeEventListener(ref.name,ref.callback)}};
  const action=installMobileSelectionAction(app as any,()=>active,()=>true,()=>({text:selectionText,start:0,end:selectionText.length}) as any,value=>asked.push(value));
  try{
    dom.emit('selectionchange');await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(button.hidden,true,'No button without a nonempty editor selection');
    selectionText='What does this mean?';dom.emit('selectionchange');await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(button.hidden,false);assert.equal(button.textContent,'Ask T3');assert.equal(button.style.top,'154px');
    const event={preventDefault(){},stopPropagation(){}};
    button.emit('pointerdown',event);button.emit('click',event);
    assert.equal(asked.length,1,'A touch must dispatch exactly once');
    assert.equal(asked[0].text,selectionText);assert.equal(asked[0].path,'Notes/Question.md');
    dom.emit('selectionchange');await new Promise(resolve=>setTimeout(resolve,100));
    active={...view,file:{path:'Notes/Other.md',extension:'md'}};
    button.emit('pointerdown',event);assert.equal(asked.length,1,'A switched editor must not dispatch stale selected text');
  }finally{
    action.dispose();Object.assign(globalThis,{document:oldDocument,window:oldWindow});
  }
  assert.equal(button.removed,true);assert.equal(dom.listeners.get('selectionchange')?.size,0);
});
