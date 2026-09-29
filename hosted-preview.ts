import {sameWorkspacePath} from './folder-link';
import {contentHash} from './completion';
import {activeInlineIds,regionBody} from './inline-thread';
import {hostedPaths,hostedRequestHash,validateHostedRequest,type HostedInlineState,type InlineFiles,type InlineHostTarget} from './hosted-inline';

export type HostedPreview=Pick<HostedInlineState,'body'|'hashes'|'status'|'notePath'>;

/** Read the host's progress directly; Sync still owns transport of saved notes. */
export class HostedPreviewReader {
  private stopped=false;
  private connections=new Map<string,{expires:number;opened:Promise<{files:InlineFiles;close():void}>}>();
  constructor(private vaultId:string,private target:(id:string)=>Promise<InlineHostTarget|undefined>,private open:(target:InlineHostTarget)=>Promise<{files:InlineFiles;close():void}>){ }
  async read(id:string):Promise<HostedPreview|undefined>{
    if(this.stopped)return;
    const target=await this.target(id);if(!target||this.stopped)return;
    const key=JSON.stringify(target);
    let connection=this.connections.get(key);
    if(connection&&connection.expires<=Date.now()){this.connections.delete(key);void connection.opened.then(opened=>opened.close()).catch(()=>{});connection=undefined;}
    if(!connection){connection={expires:Date.now()+180_000,opened:this.open(target)};this.connections.set(key,connection);}
    try{
      const {files}=await connection.opened;if(this.stopped)return;
      const paths=hostedPaths(target.directory,id),raw=await files.read(paths.request);if(!raw)return;
      const request=validateHostedRequest(JSON.parse(raw));
      if(request.id!==id||request.vaultId!==this.vaultId||request.host.environmentId!==target.environmentId||!sameWorkspacePath(request.host.workspaceRoot,target.workspaceRoot)||request.host.directory!==target.directory)return;
      const bytes=await files.read(paths.state);if(!bytes)return;
      const state:HostedInlineState=JSON.parse(bytes);
      if(state.requestHash!==hostedRequestHash(request)||!Array.isArray(state.hashes)||typeof state.body!=='string'||state.status==='conflict')return;
      return state;
    }catch(error){
      if(this.connections.get(key)===connection)this.connections.delete(key);
      void connection.opened.then(opened=>opened.close()).catch(()=>{});throw error;
    }
  }
  dispose(){this.stopped=true;for(const c of this.connections.values())void c.opened.then(opened=>opened.close()).catch(()=>{});this.connections.clear();}
}

/** Never conceal an edited response or attach a preview to a different note. */
export function hostedPreviewRanges(document:string,path:string,previews:ReadonlyMap<string,HostedPreview>){
  return activeInlineIds(document).flatMap(id=>{
    const preview=previews.get(id),region=regionBody(document,id);
    if(!preview||preview.notePath!==path||preview.status==='conflict'||!region||!preview.body||preview.body===region.body||!preview.hashes.includes(contentHash(region.body)))return [];
    return [{id,from:region.from,to:region.to,body:preview.body}];
  });
}
