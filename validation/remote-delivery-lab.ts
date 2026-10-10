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
    // Controlled fault injection is confined to this synthetic desktop. It
    // leaves a real browser socket OPEN while dropping its outgoing file and
    // Ping frames; the actual plugin must detect and replace it itself.
    const send=WebSocket.prototype.send,silent=new WeakSet<WebSocket>();let fault:'none'|'once'|'persistent'='none',silenced=0;
    WebSocket.prototype.send=function(data){
      if(fault!=='none'){
        try{const frame=typeof data==='string'?JSON.parse(data):undefined;
          if(frame?._tag==='Request'&&frame.tag==='projects.readFile'&&/\/(leases\/|lease-catalog\.json)/.test(frame.payload.relativePath)&&!silent.has(this)&&(fault==='persistent'||silenced===0)){silent.add(this);silenced++;write('network-fault',{fault,silenced,at:new Date().toISOString()});}
        }catch{}
        if(silent.has(this))return;
      }
      send.call(this,data);
    };
    this.register(()=>{WebSocket.prototype.send=send;});
    this.app.workspace.onLayoutReady(()=>void (async()=>{
      for(let n=0;n<120;n++){if((this.app as any).plugins.plugins['send-to-t3-code']?.settings?.vaultId)break;await new Promise(r=>setTimeout(r,250));}
      const file=this.app.vault.getFileByPath(config.note);if(file)await this.app.workspace.getLeaf(false).openFile(file);
      const plugin=(this.app as any).plugins.plugins['send-to-t3-code'],ready={root,note:config.note,version:plugin?.manifest.version,instanceId:plugin?.clientMaintenance?.client.instanceId,at:new Date().toISOString()};
      write('ready',ready);
      const starts=join(config.evidence,`${config.role}-starts.json`),previous=existsSync(starts)?JSON.parse(readFileSync(starts,'utf8')):[];write('starts',[...previous,ready].slice(-32));
    })().catch(error=>write('error',{error:error.message})));
    this.registerInterval(window.setInterval(()=>{
      const command=join(config.evidence,`${config.role}-observe.json`);if(!existsSync(command))return;
      const {id,networkFault}=JSON.parse(readFileSync(command,'utf8'));unlinkSync(command);
      if(['none','once','persistent'].includes(networkFault)){fault=networkFault;silenced=0;}
      void (async()=>{
        const plugin=(this.app as any).plugins.plugins['send-to-t3-code'];
        const file=this.app.vault.getFileByPath(config.note),view=this.app.workspace.getActiveViewOfType(MarkdownView);
        write(id,{root,version:plugin?.manifest.version,instanceId:plugin?.clientMaintenance?.client.instanceId,recovery:plugin?.connectionRecovery?.status(),networkFault:{fault,silenced},vaultId:plugin?.settings?.vaultId,settingsBytes:(await this.app.vault.adapter.read('.obsidian/plugins/send-to-t3-code/data.json')).length,
          note:file?await this.app.vault.read(file):null,editorPath:view?.file?.path,editor:view?.getViewData(),
          visible:typeof document==='undefined'?null:document.querySelector('.workspace-leaf.mod-active .view-content')?.textContent,
          failures:this.app.loadLocalStorage(`t3-send-failures-v1:${plugin?.settings?.vaultId}`)});
      })().catch(error=>write(id,{error:error.message}));
    },500));
  }
}
