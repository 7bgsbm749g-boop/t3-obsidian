import type {JournalFiles} from './observation-engine';
import type {VaultRemote} from './vault-connection';

// Hidden config files are local to each Obsidian device. A paired client
// publishes its workflow records into the coordinator's hidden vault storage.
export class RemoteJournalFiles implements JournalFiles {
  private remote?:VaultRemote;
  private connecting?:Promise<VaultRemote>;
  constructor(private root:string,private connect:()=>Promise<VaultRemote>){}
  private async using<T>(run:(remote:VaultRemote)=>Promise<T>):Promise<T>{
    try{
      const remote=this.remote??await (this.connecting??=this.connect());
      this.remote=remote;this.connecting=undefined;
      return await run(remote);
    }catch(error){this.remote?.close();this.remote=undefined;this.connecting=undefined;throw error;}
  }
  async exists(path:string):Promise<boolean>{
    if(!path.endsWith('.json'))return true; // writeFile creates parents recursively.
    return this.using(async remote=>await remote.readFile(this.root,path)!==undefined);
  }
  async read(path:string):Promise<string>{
    const value=await this.using(remote=>remote.readFile(this.root,path));
    if(value===undefined)throw Error(`T3 workflow file is missing: ${path}`);
    return value;
  }
  async write(path:string,bytes:string):Promise<void>{await this.using(remote=>remote.writeFile(this.root,path,bytes));}
  async mkdir(_path:string):Promise<void>{/* The remote write creates parents. */}
  close(){this.remote?.close();this.remote=undefined;this.connecting=undefined;}
}
