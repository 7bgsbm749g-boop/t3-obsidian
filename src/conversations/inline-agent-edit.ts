import {pendingApprovals} from '../interaction/approvals';
import {pendingQuestions} from '../interaction/questions';
import type {Editor} from 'obsidian';
import {responseIds} from '../responses/response-container';
import {applyThreadItem,turnForMessage,turnPhase,type InlineThreadState} from './inline-thread';
import type {ThreadStreamItem,ThreadWatch} from './thread-stream';

export interface ComposerActivity {status:string;lines:string[];running:boolean;requestKey?:string}

export class InlineAgentEdit {
  private expected:string;
  private from:number;
  private to:number;
  private written='';
  private source?:string;
  private earlierSources=new Set<string>();
  private closedBlock=false;
  private confirmingCompletion=false;
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
    return [instruction,'Obsidian inline editing. The caret is between before and after. Replace selection, or insert at the caret when selection is empty. Output the exact Markdown to type inside one <edit-'+this.token+'>...</edit-'+this.token+'> block. Use no padding or extra newlines inside the delimiters. If the user steers you, a new block must contain the complete revised replacement for the same range. Keep all other messages outside the block. Do not also apply this edit with tools.',JSON.stringify(context)].join('\n\n');
  }
  requestState(){return {...this.state,activities:this.state.activities.filter(a=>a.turnId===this.turnId)};}
  subscribe(watch:ThreadWatch){if(this.activity.running)this.watch=watch;else watch.stop();}
  dispose(){this.watch?.stop();this.watch=undefined;}
  finish(status:string){this.state={messages:[],activities:[]};this.activity={...this.activity,requestKey:undefined,running:false,status};this.dispose();this.changed();}
  reconnect(){if(this.activity.running){this.activity={...this.activity,status:'Reconnecting'};this.changed();}}
  receive(item:ThreadStreamItem,messageId:string){
    if(!this.activity.running)return;
    try{
      const next=applyThreadItem(this.state,item).state;
      if(next===this.state)return;
      this.state=next;
      const turn=turnForMessage(this.state,messageId);
      if(!turn){if(this.state.starts?.[messageId]?.failed)this.finish('The agent could not start this run.');return;}
      this.turnId=turn;
      const messages=this.state.messages.filter(m=>m.turnId===turn&&m.role==='assistant');
      const open='<edit-'+this.token+'>',close='</edit-'+this.token+'>';
      const lines=this.state.messages.filter(m=>m.turnId===turn&&m.role==='reasoning').slice(-6).map(m=>m.text.slice(-1000));
      for(const msg of messages){
        const blocks=msg.text.split(open);
        if(blocks.length===1){if(msg.text.trim())lines.push(msg.text.slice(-1000));continue;}
        if(this.earlierSources.has(msg.id))continue;
        const revision=Boolean(this.source&&this.source!==msg.id);
        if(revision)this.earlierSources.add(this.source!);
        this.source=msg.id;
        const last=blocks[blocks.length-1];
        this.closedBlock=last.includes(close);
        // A later replacement is atomic. Retain the last complete edit if
        // the transcript ends partway through a revision or mentions its tag.
        let body=this.closedBlock?last:blocks.slice(1,-1).reverse().find(block=>block.includes(close))??last;
        const end=body.indexOf(close);
        if(end>=0){body=body.slice(0,end);}
        else for(let n=Math.min(body.length,close.length-1);n>0;n--)if(body.endsWith(close.slice(0,n))){body=body.slice(0,-n);break;}
        // Wait for a revised replacement to be complete before removing earlier text.
        const revising=!body.startsWith(this.written);
        if((!revising||end>=0)&&(body!==this.written||end>=0&&this.to>this.from)){
          this.checkEditor();
          const left=revising?this.from-this.written.length:this.from;
          const addition=revising?body:body.slice(this.written.length);
          this.editor.replaceRange(addition,this.editor.offsetToPos(left),this.editor.offsetToPos(this.to));
          this.expected=this.expected.slice(0,left)+addition+this.expected.slice(this.to);
          this.from=left+addition.length;this.to=this.from;this.written=body;
        }
        if(blocks[0].trim())lines.push(blocks[0].slice(-1000));
        for(const block of blocks.slice(1)){
          const marker=block.indexOf(close);
          const tail=marker<0?'':block.slice(marker+close.length);
          if(tail.trim())lines.push(tail.slice(-1000));
        }
      }
      lines.push(...this.state.activities.filter(a=>a.turnId===turn&&a.summary).slice(-8).map(a=>a.summary.slice(0,300)));
      const activities=this.requestState().activities;
      const questions=pendingQuestions(activities),approvals=pendingApprovals(activities);
      const requestKey=questions.length||approvals.length?JSON.stringify([questions,approvals]):'';
      this.activity={running:true,status:requestKey?'Waiting for input':'Working',lines:lines.slice(-12),requestKey};
      const phase=turnPhase(this.state,turn);
      if(phase==='complete'){
        // A completion event can name the last *progress* message as final.
        // Inspect the canonical turn before releasing the writer, including
        // completed tool-only runs for which there is no assistant message.
        const thread=item.kind==='snapshot'?item.snapshot.thread:undefined;
        const canonical=thread?.latestTurn?.turnId===turn?thread.latestTurn:thread?.turns?.[turn];
        const confirmed=canonical?.state==='completed'&&!thread?.messages.some(m=>m.turnId===turn&&m.role==='assistant'&&m.streaming);
        if(!confirmed||!this.closedBlock&&!this.confirmingCompletion){
          if(!this.confirmingCompletion){this.confirmingCompletion=true;this.watch?.refresh?.();}
          this.activity.status='Finishing';this.changed();return;
        }
      }
      if(phase!=='running')this.finish(phase==='complete'?(this.closedBlock?'Edit complete':this.source?'The edit ended before its closing marker':'Finished without an inline edit'):phase==='error'?'Run failed':'Stopped');
      else this.changed();
    }catch(error){this.finish(error instanceof Error?error.message:String(error));}
  }
}
