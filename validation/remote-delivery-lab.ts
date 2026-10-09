/** Test-only desktop observer. Uses the real installed plugin and real T3 RPC. */
import {Plugin,MarkdownView} from 'obsidian';
import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';

export default class RemoteDeliveryLab extends Plugin {
  async onload(){
    const root=(this.app.vault.adapter as any).getBasePath();
    if(!['/home/ubuntu/vaults/Sync Test A','/home/ubuntu/vaults/Sync Test B'].includes(root))throw Error('Synthetic lab vault required.');
    const config=JSON.parse(readFileSync(join(root,'.obsidian/plugins/remote-delivery-lab/config.json'),'utf8'));
    const local=JSON.parse(readFileSync(join(config.evidence,`credential-${config.role}.json`),'utf8'));
    this.app.saveLocalStorage('send-to-t3-code-device-v1',local);
    const write=(name:string,value:any)=>writeFileSync(join(config.evidence,`${config.role}-${name}.json`),JSON.stringify(value,null,2)+'\n');
    this.app.workspace.onLayoutReady(()=>void (async()=>{
      for(let n=0;n<120;n++){if((this.app as any).plugins.plugins['send-to-t3-code']?.settings?.vaultId)break;await new Promise(r=>setTimeout(r,250));}
      const file=this.app.vault.getFileByPath(config.note);if(file)await this.app.workspace.getLeaf(false).openFile(file);
      write('ready',{root,note:config.note,version:(this.app as any).plugins.plugins['send-to-t3-code']?.manifest.version});
    })().catch(error=>write('error',{error:error.message})));
    this.registerInterval(window.setInterval(()=>{
      const command=join(config.evidence,`${config.role}-observe.json`);if(!existsSync(command))return;
      const {id}=JSON.parse(readFileSync(command,'utf8'));unlinkSync(command);
      void (async()=>{
        const plugin=(this.app as any).plugins.plugins['send-to-t3-code'];
        const file=this.app.vault.getFileByPath(config.note),view=this.app.workspace.getActiveViewOfType(MarkdownView);
        write(id,{root,version:plugin?.manifest.version,vaultId:plugin?.settings?.vaultId,settingsBytes:(await this.app.vault.adapter.read('.obsidian/plugins/send-to-t3-code/data.json')).length,
          note:file?await this.app.vault.read(file):null,editorPath:view?.file?.path,editor:view?.getViewData(),
          visible:typeof document==='undefined'?null:document.querySelector('.workspace-leaf.mod-active .view-content')?.textContent,
          failures:this.app.loadLocalStorage(`t3-send-failures-v1:${plugin?.settings?.vaultId}`)});
      })().catch(error=>write(id,{error:error.message}));
    },500));
  }
}
