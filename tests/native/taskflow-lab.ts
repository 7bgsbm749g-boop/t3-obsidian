import {Plugin,MarkdownView} from 'obsidian';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** Isolated vault only: exercise native properties and the production MCP bridge. */
export default class TaskflowLab extends Plugin {
  async onload(){this.app.workspace.onLayoutReady(()=>{void this.run();});}
  private async run(){
    const result:{ok:boolean;checks:string[];error?:string}={ok:false,checks:[]};
    const root=(this.app.vault.adapter as unknown as {getBasePath():string}).getBasePath();
    const check=(value:unknown,message:string)=>{if(!value)throw Error(message);result.checks.push(message);};
    const wait=async(work:()=>Promise<boolean>)=>{for(let n=0;n<100;n++){if(await work())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Native state did not settle.');};
    const manager=(this.app as any).plugins;
    try{
      await manager.loadPlugin('task-flow'); await manager.loadPlugin('t-three-code');
      const flow=manager.plugins['task-flow'],t3=manager.plugins['t-three-code'];
      await flow.api.ready;
      const target=await this.app.vault.create('Design.md','---\naliases: [Spec]\nother: preserved\n---\n# Design\n\nKeep this body.\n');
      const source=await this.app.vault.create('Tasks.md','- [ ] Implement [[Design|spec]]\n');
      const ids=()=>this.app.metadataCache.getFileCache(target)?.frontmatter?.['taskflow-task-ids'];
      await wait(async()=>Array.isArray(ids())&&ids().length===1);
      const taskId=ids()[0];check(typeof taskId==='string','linked note automatically has one task ID');
      check((await flow.api.get({taskId})).state==='todo','association leaves task todo');
      check((await this.app.vault.read(target)).includes('other: preserved')&&(await this.app.vault.read(target)).includes('Keep this body.'),'native property update preserves other properties and body');
      const footer=t3.messageFooter(target.path);check(footer.endsWith(`\nTaskflow task ID: ${taskId}`),'native T3 prompt includes only associated task ID');
      check(!footer.includes('expectedRevision')&&!footer.includes('assignmentId'),'prompt excludes API control data');
      const command=async(kind:string,extra:Record<string,unknown>={})=>t3.executeAgentCommand({version:1,id:crypto.randomUUID(),kind,taskId,...extra});
      let response=await command('taskflow-get');check(response.ok,'MCP bridge reads the native task');
      response=await command('taskflow-assign',{expectedRevision:response.task.revision,assignee:'isolated-lab'});check(response.ok,'MCP bridge assigns with current revision');
      const stale=response.task.revision;
      response=await command('taskflow-start',{expectedRevision:response.task.revision,assignmentId:response.task.assignment.id});check(response.ok&&response.task.state==='in-progress','explicit start uses native Taskflow status');
      const rejected=await command('taskflow-complete',{expectedRevision:stale,assignmentId:response.task.assignment.id});check(!rejected.ok&&rejected.code==='conflict','stale completion fails through MCP bridge');
      response=await command('taskflow-get');check(response.task.state==='in-progress','unfinished work stays open between agent calls');
      response=await command('taskflow-complete',{expectedRevision:response.task.revision,assignmentId:response.task.assignment.id,result:'Native integration verified.'});check(response.ok&&response.task.state==='completed','explicit final completion updates native task');
      await this.app.vault.process(source,text=>text.replace('[[Design|spec]]','plain text'));
      await wait(async()=>!ids());check(!ids(),'removing link removes managed association');
      await this.app.vault.process(source,text=>text.replace('plain text','[[Design]]'));
      await wait(async()=>Array.isArray(ids())&&ids()[0]===taskId);
      flow.settings.autoAssociateTasks=false;await flow.saveSettings();
      await wait(async()=>!ids());check((await flow.api.get({taskId})).state==='completed','disabling association preserves completed task status');
      await this.app.workspace.getLeaf(false).openFile(target);
      const view=this.app.workspace.getActiveViewOfType(MarkdownView);check(!!view,'native source editor opens associated note');
      await this.app.vault.trash(source,true);await this.app.vault.trash(target,true);
      check(!this.app.vault.getFileByPath('Tasks.md')&&!this.app.vault.getFileByPath('Design.md'),'synthetic notes cleaned from isolated vault');
      result.ok=true;
    }catch(error){result.error=error instanceof Error?error.stack:String(error);}
    writeFileSync(join(root,'..','native-result.json'),JSON.stringify(result,null,2));
    // This lab owns its isolated application process and profile.
    (this.app as any).quit?.();
  }
}
