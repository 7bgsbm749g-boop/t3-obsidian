import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {installStreamBlockControls} from '../stream-block-controls';
import {renderInlineTurn} from '../inline-thread';
import {responseMoveHistory} from '../response-move';
const fs=require('node:fs'),path=require('node:path');
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
/** Synthetic real-editor fixture. External control changes provider output
 * only; the drag itself is performed with native pointer input. */
export default class ResponseDragLab extends Plugin {
  async onload(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated synthetic lab is required.');
    const evidence=(name:string,value:any)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
    const manager=nativeResponses(this.app),{EditorState}=require('@codemirror/state') as typeof import('@codemirror/state');
    this.registerEditorExtension([EditorState.transactionFilter.of(tr=>manager.filter(tr)),responseMoveHistory()]);
    this.register(installStreamBlockControls(this.app,document,setIcon,error=>evidence('error.json',{message:String(error),stack:(error as Error).stack})));
    this.app.workspace.onLayoutReady(()=>void (async()=>{
      const name='Response drag lab.md',initial=`# First section\n\nFirst paragraph has two lines\nthat must stay together.\n\n# Middle section\n\nMiddle paragraph.\n\n${responseAnchor(id)}\n\n# Last section\n\nLast paragraph.\n`;
      const file=this.app.vault.getFileByPath(name)??await this.app.vault.create(name,initial),leaf=this.app.workspace.getLeaf('tab');
      await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:name,mode:'source',source:false},active:true});
      const view=leaf.view as MarkdownView,adapter=(manager as any).wrap(view,initial),startedAt='2026-10-16T04:00:00Z';
      let output='Active response stays with its tools and controls.',lastAction='',terminal=false,finishOnMove=false;const pointerEvents:any[]=[];
      const body=()=>renderInlineTurn({messages:[{id:'answer',role:'assistant',text:output,turnId:'turn',streaming:!terminal}],activities:[],latestTurn:{turnId:'turn',state:terminal?'completed':'running',requestedAt:startedAt}} as any,'turn','Synthetic drag response',terminal?'complete':'running','collapse',undefined,undefined,undefined,'Synthetic drag response',{startedAt},'raw-markdown');
      const update=()=>adapter.setResponses([{id,body:body(),movable:!terminal}]);update();
      const complete=async(text:string)=>{terminal=true;output=text;update();const before=adapter.saved(),after=before.replace(responseAnchor(id),body());adapter.prepareMaterialization(before,after,[id]);await this.app.vault.modify(file,after);if(!adapter.acceptCommitted(after,[id]))throw Error('Final synthetic response was not adopted.');};
      const pointer=(event:PointerEvent)=>{
        if(event.type==='pointerdown'||event.type==='pointerup')pointerEvents.push({type:event.type,terminal,at:Date.now()});
        if(event.type==='pointermove'&&event.buttons&&finishOnMove){finishOnMove=false;setTimeout(()=>{pointerEvents.push({type:'finish-during-pointer',terminal,dragging:!!document.querySelector('.send-to-t3-response-drag-ghost'),at:Date.now()});void complete('FINAL_DURING_DRAG_OK').catch(error=>evidence('error.json',{message:String(error)}));},150);}
      };
      for(const type of ['pointerdown','pointermove','pointerup'])window.addEventListener(type,pointer as EventListener,true);
      this.register(()=>{for(const type of ['pointerdown','pointermove','pointerup'])window.removeEventListener(type,pointer as EventListener,true);});
      const snapshot=()=>{
        const cm=(view.editor as any).cm,grip=view.contentEl.querySelector('.send-to-t3-response-drag'),rect=grip?.getBoundingClientRect();
        evidence('state.json',{note:name,saved:adapter.saved(),display:view.editor.getValue(),terminal,pointerEvents,grips:view.contentEl.querySelectorAll('.send-to-t3-response-drag').length,grip:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:undefined,undoDepth:require('@codemirror/commands').undoDepth(cm.state)});
      };
      const timer=setInterval(()=>{void (async()=>{
        const actionPath=path.join(root,'action.json');
        if(fs.existsSync(actionPath)){
          const action=JSON.parse(fs.readFileSync(actionPath,'utf8'));
          if(action.id!==lastAction){lastAction=action.id;
            if(action.kind==='stream'&&!terminal){output=String(action.text);update();}
            if(action.kind==='complete'&&!terminal)await complete(String(action.text??'FINAL_DRAG_LAB_OK'));
            if(action.kind==='complete-on-drag'&&!terminal)finishOnMove=true;
            if(action.kind==='snapshot')await view.save();
          }
        }
        snapshot();
      })().catch(error=>evidence('error.json',{message:error.message,stack:error.stack}));},200);
      this.register(()=>clearInterval(timer));this.register(()=>manager.dispose());snapshot();
    })().catch(error=>evidence('error.json',{message:error.message,stack:error.stack})));
  }
}
