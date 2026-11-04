/** Synthetic desktop fixture. Never loads in QLO2. All receipts stay outside Sync. */
import {Plugin,MarkdownView} from 'obsidian';
import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';

export default class SmartSendRenameLab extends Plugin {
  onload(){
    const root=(this.app.vault.adapter as any).getBasePath();
    if(!['/home/ubuntu/vaults/Sync Test A','/home/ubuntu/vaults/Sync Test B'].includes(root))throw Error('Synthetic vault required.');
    const {evidence,role,prefix}=JSON.parse(readFileSync(join(root,'.obsidian/plugins/smart-send-rename-lab/config.json'),'utf8'));
    this.app.saveLocalStorage('send-to-t3-code-device-v1',JSON.parse(readFileSync(join(evidence,`credential-${role}.json`),'utf8')));
    const write=(id:string,value:unknown)=>writeFileSync(join(evidence,`${role}-${id}.json`),JSON.stringify(value,null,2)+'\n');
    this.app.workspace.onLayoutReady(()=>write('ready',{root,at:new Date().toISOString()}));
    let busy=false;
    this.registerInterval(window.setInterval(()=>{
      const command=join(evidence,`${role}-command.json`);if(busy||!existsSync(command))return;
      const input=JSON.parse(readFileSync(command,'utf8'));unlinkSync(command);busy=true;
      void (async()=>{
        if(!/^[a-z0-9-]+$/.test(input.id)||typeof input.path!=='string'||!input.path.startsWith(prefix)||!input.path.endsWith('.md'))throw Error('Fixture path required.');
        let file=this.app.vault.getFileByPath(input.path);
        if(input.kind==='create'){
          if(file)throw Error('Fixture already exists.');
          const folder=input.path.slice(0,input.path.lastIndexOf('/'));if(folder&&!this.app.vault.getAbstractFileByPath(folder))await this.app.vault.createFolder(folder);
          file=await this.app.vault.create(input.path,input.text);
        }else if(input.kind==='append'){
          if(!file)throw Error('Fixture missing.');
          await this.app.vault.process(file,text=>text+'\n\n'+input.text);
        }else if(input.kind==='rename'){
          if(!file||!input.destination.startsWith(prefix)||!input.destination.endsWith('.md'))throw Error('Fixture destination required.');
          await this.app.vault.rename(file,input.destination);
        }else if(input.kind==='delete'){
          if(file)await this.app.vault.delete(file);file=null;
        }else if(input.kind!=='inspect')throw Error('Unknown fixture command.');
        const plugin=(this.app as any).plugins.plugins['send-to-t3-code'];
        const view=this.app.workspace.getActiveViewOfType(MarkdownView);
        write(input.id,{kind:input.kind,path:file?.path??input.path,exists:!!file,version:plugin?.manifest.version,
          note:file?await this.app.vault.read(file):null,editorPath:view?.file?.path,editor:view?.getViewData(),
          smartSend:plugin?.settings.smartSend});
      })().catch(error=>write(input.id,{error:String(error),stack:error.stack})).finally(()=>{busy=false;});
    },200));
  }
}
