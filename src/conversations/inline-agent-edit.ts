import type {Editor} from 'obsidian';
import {responseIds} from '../responses/response-container';
import {applyThreadItem,turnForMessage,turnPhase,type InlineThreadState} from './inline-thread';
import type {ThreadStreamItem,ThreadWatch} from './thread-stream';

export interface ComposerActivity {status:string;lines:string[];running:boolean}

export class InlineAgentEdit {
  private expected:string;
  private from:number;
  private to:number;
  private written='';
  private source?:string;
  private closedBlock=false;
  private state:InlineThreadState={messages:[],activities:[]};
  private watch?:ThreadWatch;
  activity:ComposerActivity={status:'Waiting for T3',lines:[],running:true};
  turnId?:string;

  constructor(private editor:Editor,private available:()=>boolean,private token:string,private changed:()=>void,range:{document:string;from:number;to:number}){
    this.expected=range.document;
    this.from=range.from;
    this.to=range.to;
    this.checkEditor();
  }
  private checkEditor(){
    if(!this.available()||this.editor.getValue()!==this.expected)throw Error('The editor changed. Inline typing stopped to preserve your edits.');
    if(responseIds(this.expected).length)throw Error('Finish the editor stream in this note before starting an inline edit.');
  }
  prompt(instruction:string){
    const context={before:this.expected.slice(Math.max(0,this.from-2048),this.from),selection:this.expected.slice(this.from,this.to),after:this.expected.slice(this.to,this.to+2048)};
    return [instruction,'Obsidian inline editing. The caret is between before and after. Replace selection, or insert at the caret when selection is empty. Output the exact Markdown to type inside one <edit-'+this.token+'>...</edit-'+this.token+'> block. Keep all other messages outside the block. Do not also apply this edit with tools.',JSON.stringify(context)].join('\n\n');
  }
  subscribe(watch:ThreadWatch){if(this.activity.running)this.watch=watch;else watch.stop();}
  dispose(){this.watch?.stop();this.watch=undefined;}
  finish(status:string){this.state={messages:[],activities:[]};this.activity={...this.activity,running:false,status};this.dispose();this.changed();}
  reconnect(){if(this.activity.running){this.activity={...this.activity,status:'Reconnecting'};this.changed();}}
  receive(item:ThreadStreamItem,messageId:string){
    if(!this.activity.running)return;
    try{
      this.state=applyThreadItem(this.state,item).state;
      const turn=turnForMessage(this.state,messageId);
      if(!turn)return;
      this.turnId=turn;
      const messages=this.state.messages.filter(m=>m.turnId===turn&&m.role==='assistant');
      const open='<edit-'+this.token+'>',close='</edit-'+this.token+'>';
      const lines:string[]=[];
      for(const msg of messages){
        const start=msg.text.indexOf(open);
        if(start<0){if(msg.text.trim())lines.push(msg.text.slice(-1000));continue;}
        if(this.source&&this.source!==msg.id)continue;
        this.source=msg.id;
        let body=msg.text.slice(start+open.length);
        const end=body.indexOf(close);
        if(end>=0){body=body.slice(0,end);this.closedBlock=true;}
        else for(let n=Math.min(body.length,close.length-1);n>0;n--)if(body.endsWith(close.slice(0,n))){body=body.slice(0,-n);break;}
        if(this.written.startsWith(body)&&body!==this.written)continue; // Earlier snapshot.
        if(!body.startsWith(this.written))throw Error('The provider revised its edit. Inline typing stopped.');
        if(body.length>this.written.length||end>=0&&this.to>this.from){
          this.checkEditor();
          const addition=body.slice(this.written.length);
          this.editor.replaceRange(addition,this.editor.offsetToPos(this.from),this.editor.offsetToPos(this.to));
          this.expected=this.expected.slice(0,this.from)+addition+this.expected.slice(this.to);
          this.from+=addition.length;this.to=this.from;this.written=body;
        }
        if(start)lines.push(msg.text.slice(0,start).slice(-1000));
        if(end>=0){const tail=msg.text.slice(start+open.length+end+close.length);if(tail.trim())lines.push(tail.slice(-1000));}
      }
      lines.push(...this.state.activities.filter(a=>a.turnId===turn&&a.summary).slice(-8).map(a=>a.summary.slice(0,300)));
      this.activity={running:true,status:'Working',lines:lines.slice(-12)};
      const phase=turnPhase(this.state,turn);
      if(phase!=='running')this.finish(phase==='complete'?(this.closedBlock?'Edit complete':this.source?'The edit ended before its closing marker':'Finished without an inline edit'):phase==='error'?'Run failed':'Stopped');
      else this.changed();
    }catch(error){this.finish(error instanceof Error?error.message:String(error));}
  }
}
