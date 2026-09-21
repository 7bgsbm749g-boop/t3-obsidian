// Run with: node scripts/preview-workflow-menu.mjs, then open its localhost URL.
// Real DOM/event propagation; the small Menu double models Obsidian's row
// click-to-edit/hide behavior, item order, and menu-group rebuilding.
import {installWorkflowMenuOrder} from '../workflow-menu';
import {decorateWorkflowActivity,type WorkflowActivity} from '../workflow-activity';

function assert(value:unknown,message:string){if(!value)throw Error(message);}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(count=3){
  const root=document.createElement('div');document.querySelector('#fixtures')!.appendChild(root);
  const folder=document.createElement('div');folder.className='nav-folder-title';folder.textContent='Gym';root.appendChild(folder);
  const dom=document.createElement('div');dom.className='menu';root.appendChild(dom);
  const scroll=document.createElement('div');scroll.className='menu-scroll';dom.appendChild(scroll);
  const rows=Array.from({length:count},(_,i)=>{const el=document.createElement('div');el.className='menu-item';const name=document.createElement('span');name.className='menu-item-title';name.textContent=['Gym workflow','Example workflow','Summarize'][i]??`Workflow ${i+1}`;el.appendChild(name);return {id:String(i),name:name.textContent!,item:{dom:el},el};});
  const setup=document.createElement('div');setup.className='menu-item';setup.textContent='+ Setup new workflow…';
  const separator=document.createElement('div');separator.className='menu-separator';
  let opened=0,newOpened=0,hidden=0,disposed=0,fail=false,previousHide=0,delay:Promise<void>|undefined;
  const saved:string[][]=[],reports:unknown[]=[];const activity=new Map<string,WorkflowActivity>();
  const menu={dom,items:[...rows.map(row=>row.item),{dom:separator},{dom:setup}],selected:0,hideCallback:()=>{previousHide++;},setUseNativeMenu(){},onHide(callback:()=>void){this.hideCallback=callback;},hide(){hidden++;this.hideCallback();},unselect(){this.selected=-1;},sort(){scroll.replaceChildren();let group=document.createElement('div');group.className='menu-group';scroll.appendChild(group);for(const item of this.items){if(item.dom===separator){scroll.appendChild(separator);group=document.createElement('div');group.className='menu-group';scroll.appendChild(group);}else group.appendChild(item.dom);}}};
  for(const row of rows)row.el.addEventListener('click',()=>{opened++;menu.hide();});
  setup.addEventListener('click',()=>{newOpened++;menu.hide();});menu.sort();
  const controller=installWorkflowMenuOrder(menu as any,menu as any,rows as any,async(ids)=>{if(delay)await delay;if(fail)throw Error('Storage unavailable');saved.push(ids);},error=>reports.push(error),()=>{disposed++;},()=>activity)!;
  const handle=(id:number)=>rows[id].el.querySelector<HTMLElement>('.t3-workflow-drag-handle')!;
  const point=(id:number)=>{const rect=rows[id].el.getBoundingClientRect();return {clientX:rect.right-12,clientY:rect.top+rect.height/2};};
  const pointer=(target:EventTarget,type:string,point:{clientX:number;clientY:number})=>{const event=new PointerEvent(type,{...point,pointerId:1,isPrimary:true,button:0,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
  const down=(id:number)=>{
    // Synthetic events do not create a browser pointer; native/manual dragging
    // uses the real pointer capture methods unchanged.
    handle(id).setPointerCapture=()=>{};pointer(handle(id),'pointerdown',point(id));
  };
  const move=(id:number,after=false)=>{const p=point(id);p.clientY+=after?12:-12;pointer(window,'pointermove',p);return p;};
  return {root,folder,rows,setup,menu,controller,saved,reports,activity,handle,point,pointer,down,move,opened:()=>opened,newOpened:()=>newOpened,hidden:()=>hidden,disposed:()=>disposed,previousHide:()=>previousHide,setFail:()=>{fail=true;},setDelay:(value:Promise<void>)=>{delay=value;},order:()=>menu.items.filter(item=>rows.some(row=>row.item===item)).map(item=>rows.find(row=>row.item===item)!.id).join(','),cleanup(){controller.dispose();root.remove();}};
}

async function run(){
  const results:{name:string;passed:boolean;error?:string}[]=[];
  async function check(name:string,body:()=>Promise<void>|void){try{await body();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:String(error)});}}
  await check('drag down/up persists and keeps DOM/keyboard order aligned without opening an editor',async()=>{
    const f=fixture();try{f.down(0);let p=f.move(2,true);assert(f.rows[2].el.classList.contains('t3-workflow-drop-after'),'drop marker missing');f.pointer(window,'pointerup',p);f.handle(0).click();await flush();assert(f.saved[0].join(',')==='1,2,0','wrong saved order');assert(f.order()==='1,2,0','keyboard order stale');assert(Array.from(f.menu.dom.querySelectorAll('.t3-workflow-menu-row')).map(el=>f.rows.find(row=>row.el===el)!.id).join(',')===f.order(),'DOM order stale');assert(f.opened()===0&&f.hidden()===0,'drag opened/closed menu');f.down(0);p=f.move(1);f.pointer(window,'pointerup',p);await flush();assert(f.order()==='0,1,2','upward reorder failed');}finally{f.cleanup();}
  });
  for(const cancellation of ['escape','cancel','outside','setup','no-move','hide'])await check(`${cancellation} does not save or leak drag listeners`,async()=>{
    const f=fixture();try{f.down(0);let p=f.point(0);if(cancellation!=='no-move')p=f.move(2,true);if(cancellation==='escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));else if(cancellation==='cancel')f.pointer(window,'pointercancel',p);else if(cancellation==='hide')f.menu.hide();else {if(cancellation==='outside')p.clientX=0;if(cancellation==='setup')p.clientY=f.setup.getBoundingClientRect().bottom;f.pointer(window,'pointerup',p);}await flush();assert(f.saved.length===0,'cancelled drag saved');assert(!f.menu.dom.classList.contains('t3-workflow-dragging'),'drag styling leaked');const event=new MouseEvent('mousedown',{cancelable:true});window.dispatchEvent(event);assert(!event.defaultPrevented,'global capture listener leaked');if(cancellation==='hide')assert(f.previousHide()===1&&f.disposed()===1,'hide callbacks lost');}finally{f.cleanup();}
  });
  await check('failed persistence leaves the old order and allows retry',async()=>{const f=fixture();try{f.setFail();f.down(0);const p=f.move(2,true);f.pointer(window,'pointerup',p);await flush();assert(f.order()==='0,1,2'&&f.reports.length===1,'failed save changed order');assert(!f.menu.dom.hasAttribute('aria-busy'),'busy state stuck');}finally{f.cleanup();}});
  await check('an in-flight save blocks editor clicks and tolerates menu dismissal',async()=>{const f=fixture();try{let release!:()=>void;f.setDelay(new Promise<void>(resolve=>{release=resolve;}));f.down(0);f.pointer(window,'pointerup',f.move(2,true));f.rows[1].el.click();assert(f.opened()===0,'editor opened before save');f.menu.hide();release();await flush();assert(f.saved.length===1&&f.disposed()===1,'save/cleanup failed');}finally{f.cleanup();}});
  await check('name clicks and the setup action keep their existing behavior',()=>{let f=fixture();try{f.rows[0].el.click();assert(f.opened()===1&&f.hidden()===1,'editing broken');}finally{f.cleanup();}f=fixture();try{f.setup.click();assert(f.newOpened()===1&&f.hidden()===1,'creation broken');}finally{f.cleanup();}});
  await check('Alt+arrows reorder accessibly',async()=>{const f=fixture();try{f.handle(0).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true}));await flush();assert(f.order()==='1,0,2','keyboard reorder failed');}finally{f.cleanup();}});
  await check('activity refresh works for a single workflow, persists through handoffs, and cleans up',()=>{const f=fixture(1);try{assert(!f.handle(0),'single workflow should have no grip');for(const state of ['running','completed','blocked'] as const){f.activity.set('0',state);f.controller.refresh();assert(f.rows[0].el.getAttribute('data-t3-workflow-activity')===state,'row activity missing');assert(f.rows[0].el.querySelectorAll('.t3-workflow-progress-border').length===1,'border duplicated');}f.activity.clear();f.controller.refresh();assert(!f.rows[0].el.hasAttribute('data-t3-workflow-activity'),'completed batch border stuck');f.activity.set('0','running');f.controller.refresh();f.controller.dispose();assert(!f.rows[0].el.querySelector('.t3-workflow-progress-border'),'unload border leaked');}finally{f.cleanup();}});
  (window as any).workflowMenuResults=results;
  document.querySelector('#results')!.textContent=JSON.stringify(results,null,2);
  const demo=fixture();demo.activity.set('0','completed');demo.activity.set('1','running');demo.activity.set('2','queued');demo.controller.refresh();decorateWorkflowActivity(demo.folder,'running');
  (window as any).workflowMenuDemo=demo;
}
void run();
