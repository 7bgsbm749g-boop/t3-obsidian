import {Component,MarkdownRenderer,setIcon,type App} from 'obsidian';
import type {InlineThreadState,InlineSubagent} from './inline-thread';
import {chatTimeline,type ChatSegment} from './chat-timeline';
import {reconcileResponseDOM} from '../responses/response-dom';
import {clockForDocument} from '../shared/clock';
import {elapsedRun} from '../responses/response-presentation';
import type {SubagentSource} from '../responses/response-subagents';

interface Fragment {el:HTMLElement;component:Component;text:string;revision:number}
interface SegmentView {el:HTMLElement;input?:Fragment;work:HTMLDetailsElement;summary:HTMLElement;history:HTMLElement;fragments:Map<string,Fragment>;phase?:boolean;timing?:ChatSegment['timing'];children?:HTMLElement;childKey?:string}
/** The workspace shell around the same Markdown work/tool presentation used by
 * note streams. Keyed nodes preserve disclosure, selection and scroll on deltas. */
export class ChatTranscript extends Component {
  private rows=new Map<string,SegmentView>();private closed=false;
  constructor(private app:App,readonly el:HTMLElement,private failure:(error:unknown)=>void,private openChild?:(child:InlineSubagent)=>void){super();}
  onload(){
    const clock=clockForDocument(this.el.ownerDocument),timer=clock.setInterval(()=>this.timers(),1000);this.register(()=>clock.clearInterval(timer));
    this.registerDomEvent(this.el,'click',event=>{
      const button=(event.target as Element).closest?.<HTMLElement>('[data-t3-open-tool-group]');if(!button)return;
      const id=decodeURIComponent(button.dataset.t3OpenToolGroup??'');
      for(const target of Array.from(this.el.querySelectorAll<HTMLDetailsElement>('[data-t3-tool-group]')))if(target.dataset.t3ToolGroup===id){target.open=true;target.scrollIntoView({block:'nearest'});}
    });
  }
  onunload(){this.closed=true;this.rows.clear();}
  private fragment(parent:HTMLElement,cls:string):Fragment{const component=new Component();this.addChild(component);return {el:parent.createDiv({cls}),component,text:'',revision:0};}
  private markdown(row:Fragment,text:string){
    if(row.text===text)return;row.text=text;const revision=++row.revision;
    const staged=row.el.cloneNode(false) as HTMLElement,component=new Component();this.addChild(component);
    void MarkdownRenderer.render(this.app,text,staged,'',component).then(()=>{
      if(this.closed||row.revision!==revision){this.removeChild(component);return;}
      const pinned=this.el.scrollHeight-this.el.scrollTop-this.el.clientHeight<64;
      reconcileResponseDOM(row.el,staged);if(pinned)this.el.scrollTop=this.el.scrollHeight;this.removeChild(row.component);row.component=component;
      for(const node of Array.from(row.el.querySelectorAll<HTMLElement>('[data-t3-tool-icon]')))if(!node.firstChild)setIcon(node,node.dataset.t3ToolIcon??'wrench');
    }).catch(error=>{this.removeChild(component);this.failure(error);});
  }
  update(state:InlineThreadState,source?:SubagentSource){
    if(this.closed)return;let cursor=this.el.firstChild;const pinned=this.el.scrollHeight-this.el.scrollTop-this.el.clientHeight<64,seen=new Set<string>();
    for(const segment of chatTimeline(state,source)){
      seen.add(segment.id);let row=this.rows.get(segment.id);
      if(!row){
        const el=this.el.createEl('section',{cls:'t3-chat-turn'}),work=el.createEl('details',{cls:'t3-chat-work'}),summary=work.createEl('summary'),history=work.createDiv({cls:'t3-chat-work-content'});
        row={el,work,summary,history,fragments:new Map()};this.rows.set(segment.id,row);
      }
      if(segment.input){
        if(!row.input){row.input=this.fragment(row.el,'t3-chat-input markdown-rendered');row.el.insertBefore(row.input.el,row.work);}
        row.input.el.toggleClass('is-steering',segment.steer);row.input.el.setAttribute('aria-label',segment.steer?'Steering message':'Your message');this.markdown(row.input,segment.input.text);
      }
      row.work.hidden=!segment.active&&!segment.work&&!segment.progress.length&&!segment.timing;
      if(row.phase!==segment.active){row.work.open=segment.active;row.phase=segment.active;}
      row.summary.setText(segment.label);if(segment.timing)row.summary.createSpan({cls:'send-to-t3-run-timer',text:' for '+elapsedRun(segment.timing)});row.timing=segment.timing;
      const visible=new Set<string>();
      let historyCursor=row.history.firstChild;
      for(const entry of segment.history??[]){
        visible.add(entry.id);let fragment=row.fragments.get(entry.id);if(!fragment){fragment=this.fragment(row.history,entry.kind==='prose'?'t3-chat-prose markdown-rendered':'t3-chat-activity markdown-rendered');row.fragments.set(entry.id,fragment);}this.markdown(fragment,entry.text);
        if(fragment.el!==historyCursor)row.history.insertBefore(fragment.el,historyCursor);historyCursor=fragment.el.nextSibling;
      }
      if(segment.activity){visible.add('activity');let fragment=row.fragments.get('activity');if(!fragment){fragment=this.fragment(row.history,'t3-chat-activity markdown-rendered');row.fragments.set('activity',fragment);}this.markdown(fragment,segment.activity);row.history.appendChild(fragment.el);}
      let resultCursor=row.work.nextSibling;
      for(const result of segment.results??[]){
        const id='result:'+result.id;visible.add(id);let fragment=row.fragments.get(id);
        if(!fragment){fragment=this.fragment(row.el,'t3-chat-result markdown-rendered');row.fragments.set(id,fragment);}this.markdown(fragment,result.text);
        if(fragment.el!==resultCursor)row.el.insertBefore(fragment.el,resultCursor);resultCursor=fragment.el.nextSibling;
      }
      if(segment.final){visible.add('final');let fragment=row.fragments.get('final');if(!fragment){fragment=this.fragment(row.el,'t3-chat-answer markdown-rendered');row.fragments.set('final',fragment);}this.markdown(fragment,segment.final.text);row.el.appendChild(fragment.el);}
      for(const [id,fragment] of row.fragments)if(!visible.has(id)){fragment.revision++;this.removeChild(fragment.component);fragment.el.remove();row.fragments.delete(id);}
      const children=source?[]:Object.values(state.subagents??{}).filter(child=>child.runId===segment.turnId&&child.childThreadId&&!child.remoteChild);
      const childKey=JSON.stringify(children);if(childKey!==row.childKey){row.childKey=childKey;row.children?.remove();row.children=row.history.createDiv({cls:'t3-chat-children'});for(const child of children){const button=row.children.createEl('button',{cls:'clickable-icon t3-chat-child',text:child.title||'Subagent',attr:{type:'button','aria-label':'Open subagent '+(child.title||child.id)}});setIcon(button.createSpan(),'bot');button.createSpan({text:child.status,cls:'t3-chat-child-status'});button.addEventListener('click',()=>this.openChild?.(child));}}
      const activity=row.fragments.get('activity')?.el;if(row.children&&activity&&row.children.nextSibling!==activity)row.history.insertBefore(row.children,activity);
      if(row.el!==cursor)this.el.insertBefore(row.el,cursor);cursor=row.el.nextSibling;
    }
    for(const [id,row] of this.rows)if(!seen.has(id)){for(const fragment of [...row.fragments.values(),...(row.input?[row.input]:[])]){fragment.revision++;this.removeChild(fragment.component);}row.el.remove();this.rows.delete(id);}
    if(pinned)this.el.scrollTop=this.el.scrollHeight;
  }
  private timers(){for(const row of this.rows.values())if(row.timing&&!row.timing.finishedAt){const timer=row.summary.querySelector<HTMLElement>('.send-to-t3-run-timer');timer?.setText(' for '+elapsedRun(row.timing));}}
}
