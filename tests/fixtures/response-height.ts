import {EditorState} from '@codemirror/state';
import {responseHeightAttribute,responseHeightProperty} from '../../response-height';
import {EditorView} from '@codemirror/view';

export function heightFixture(document='Before\n\nAfter'){
  let now=0,sequence=0,nativeHeight=10000,scrollTop=7000,rendered=true,parsing=false,mode='source',live=true,measures=0;
  const jobs=new Map<number,{at:number;run:()=>void}>(),attributes=new Map<string,string>(),properties=new Map<string,{value:string;priority:string}>(),listeners=new Map<string,Set<Function>>();
  const add=(name:string,fn:Function)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);};
  const remove=(name:string,fn:Function)=>listeners.get(name)?.delete(fn);
  const later=(fn:()=>void,delay:number)=>{jobs.set(++sequence,{at:now+delay,run:fn});return sequence;};
  const window:any={performance:{now:()=>now},requestAnimationFrame:(fn:Function)=>later(()=>fn(now),16),cancelAnimationFrame:(id:number)=>jobs.delete(id),setTimeout:later,clearTimeout:(id:number)=>jobs.delete(id),
    getComputedStyle:()=>({boxSizing:'border-box',paddingTop:'0px',paddingBottom:'0px',borderTopWidth:'0px',borderBottomWidth:'0px'}),addEventListener:add,removeEventListener:remove,getSelection:()=>({isCollapsed:true}),Event:class{constructor(public type:string){}}};
  const style={getPropertyValue:(name:string)=>properties.get(name)?.value??'',getPropertyPriority:(name:string)=>properties.get(name)?.priority??'',setProperty:(name:string,value:string,priority='')=>properties.set(name,{value,priority}),removeProperty:(name:string)=>{const old=properties.get(name)?.value??'';properties.delete(name);return old;}};
  const floor=()=>attributes.get(responseHeightAttribute)==='true'?Number.parseFloat(style.getPropertyValue(responseHeightProperty))||0:0;
  const fold={querySelector:()=>({dataset:{t3Fold:'thread:active'}}),getBoundingClientRect:()=>({height:8000,top:100-scrollTop,bottom:8100-scrollTop})};
  const scroller:any={style,clientHeight:600,clientWidth:600,clientTop:0,get scrollTop(){return scrollTop;},set scrollTop(value:number){scrollTop=Math.min(value,this.scrollHeight-this.clientHeight);},get scrollHeight(){return Math.max(nativeHeight,floor());},querySelectorAll:()=>rendered?[fold]:[],getBoundingClientRect:()=>({top:0,bottom:600})};
  const content:any={style:{},isConnected:true,getBoundingClientRect:()=>({height:Math.max(nativeHeight,floor())}),getAttribute:(name:string)=>attributes.get(name)??null,setAttribute:(name:string,value:string)=>attributes.set(name,value),removeAttribute:(name:string)=>attributes.delete(name)};
  let state=EditorState.create({doc:document});
  const cm:any={get state(){return state;},contentDOM:content,scrollDOM:scroller,scaleY:1,viewport:{from:0,to:state.doc.length},plugin:()=>({isWorking:()=>parsing}),requestMeasure:()=>{measures++;},dispatch:(spec:any)=>{
    const transaction=spec.startState?spec:state.update(spec);state=transaction.state;
    for(const effect of transaction.effects){const target=effect.value as any;if(target?.range)for(const handler of state.facet(EditorView.scrollHandler))if(handler(cm,target.range,target))break;}
    cm.onDispatch?.(spec);
  }};
  const ownerDocument:any={defaultView:window,addEventListener:add,removeEventListener:remove};
  const contentEl:any={ownerDocument,isConnected:true,contains:()=>true,querySelector:(selector:string)=>selector.includes('is-live-preview')?live?{}:null:scroller,dispatchEvent:()=>true};
  const view:any={file:{path:'Height fixture.md'},contentEl,editor:{cm},getMode:()=>mode,getViewData:()=>state.doc.toString(),setViewData:(text:string)=>{state=EditorState.create({doc:text});},save:async()=>{},requestSave:()=>{}};
  const advance=(milliseconds:number)=>{const until=now+milliseconds;let count=0;while(jobs.size){const [id,job]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(job.at>until)break;if(++count>1000)throw Error('Unbounded height guard work.');jobs.delete(id);now=job.at;job.run();}now=until;};
  return {view,cm,content,scroller,style,attributes,jobs,listeners,advance,measures:()=>measures,guarded:()=>attributes.get(responseHeightAttribute)==='true',
    height:(height:number)=>{nativeHeight=height;scrollTop=Math.min(scrollTop,scroller.scrollHeight-scroller.clientHeight);},rendered:(value:boolean)=>{rendered=value;cm.viewport={from:value?0:state.doc.length,to:state.doc.length};},parsing:(value:boolean)=>{parsing=value;},mode:(value:string)=>{mode=value;},live:(value:boolean)=>{live=value;}};
}
