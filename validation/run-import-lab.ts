import {Plugin,MarkdownView} from 'obsidian';
import {openRunImport} from '../run-import-ui';
import {importRuns} from '../run-import';
import {applyThreadItem} from '../inline-thread';
import {normalizeV2Snapshot} from '../orchestration-v2';

const fs=require('node:fs'),path=require('node:path');

/** Real native import pickers, synthetic history, no T3 dispatch or Sync. */
export default class RunImportLab extends Plugin {
  private root='';
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    this.addCommand({id:'cleanup',name:'Clean up run import fixture',callback:()=>void this.cleanup()});
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})));
  }
  private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private async run(){
    const at='2026-10-23T17:19:25.454Z';
    const inputs=[
      {id:'system-failed',text:'Background command completed (exit 1): synthetic registration',createdBy:'system',creationSource:'server'},
      {id:'provider-success',text:'Background command completed (exit 0): synthetic bridge',creationSource:'provider'},
      {id:'system-success',text:'Background command completed (exit 0): another synthetic bridge',createdBy:'system',creationSource:'provider'},
      {id:'real-completed',text:'Explain playlist sync behavior',createdBy:'user',creationSource:'mobile'},
      {id:'real-agent',text:'Review playlist sync changes',createdBy:'agent',creationSource:'mcp'},
      {id:'real-running',text:'Check playlist sync status',createdBy:'user',creationSource:'web'},
    ];
    const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:normalizeV2Snapshot({snapshotSequence:1,projection:{
      thread:{id:'synthetic-thread',projectId:'synthetic-project',title:'Run import origin fixture'},
      messages:inputs.map(input=>({...input,role:'user',runId:input.id,createdAt:at,streaming:false})),
      runs:inputs.map((input,ordinal)=>({id:input.id,userMessageId:input.id,ordinal,requestedAt:at,status:input.id==='real-running'?'running':'completed',completedAt:input.id==='real-running'?null:at})),turnItems:[],
    }})}).state;
    const runs=importRuns(state),expected=['real-running','real-agent','real-completed'];
    if(JSON.stringify(runs.map(run=>run.messageId))!==JSON.stringify(expected))throw Error('The native fixture did not exclude its notices.');
    this.write('RESULT.json',{scope:'Synthetic T3 history in real desktop Obsidian import UI. No real delivery, Sync, or native mobile coverage.',inputs,runs:runs.map(({messageId,prompt,status})=>({messageId,prompt,status})),checks:{noticesExcluded:true,completedRunningAndAgentPromptsRetained:true},testThreads:[],dispatches:0});
    const file=this.app.vault.getFileByPath('Reference.md')!;
    await this.app.workspace.getLeaf(false).openFile(file);
    openRunImport(this.app,file.path,{
      projects:()=>[{id:'synthetic-project',name:'Synthetic project'} as any],projectLabel:()=> 'Synthetic project',
      threads:async()=>[{id:'synthetic-thread',title:'Run import origin fixture',status:'Completed'} as any],
      runs:async()=>runs,
      attach:async()=>{throw Error('Cancel the confirmation; this fixture never imports or dispatches.');},
    });
    this.registerInterval(window.setInterval(()=>{
      this.write('VISIBLE.json',{modalText:document.querySelector('.modal-container')?.textContent,items:Array.from(document.querySelectorAll('.suggestion-item')).map(item=>item.textContent)});
    },500));
  }
  private async cleanup(){
    for(const pane of this.app.workspace.getLeavesOfType('markdown'))if(['Reference.md','Virtual.md'].includes((pane.view as MarkdownView).file?.path??''))pane.detach();
    for(const name of ['Reference.md','Virtual.md']){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
    this.write('CLEANUP.json',{testThreads:[],deletedNotes:['Reference.md','Virtual.md'],remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path)});
  }
}
