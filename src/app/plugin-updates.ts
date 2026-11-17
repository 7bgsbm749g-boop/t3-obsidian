import {isRecord} from '../shared/values';

export const RELEASE_REPOSITORY='7bgsbm749g-boop/t3-obsidian';
export const RELEASE_API=`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
const RELEASE_DOWNLOAD=`https://github.com/${RELEASE_REPOSITORY}/releases/download/`;
const limits={'manifest.json':16_384,'main.js':20_000_000,'styles.css':1_000_000};
export type ReleaseFile=keyof typeof limits;
export type Release={version:string;tag:string;body:string;assets:Record<ReleaseFile,string>};
export type UpdateManifest={id:string;version:string;minAppVersion:string;isDesktopOnly?:boolean};
export type ReleaseRequest=(url:string)=>Promise<{status:number;text:string}>;

function versionParts(value:string){const match=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.exec(value);return match?.slice(1,4).map(Number);}
/** Test builds compare by their numeric source base; never downgrade a newer base. */
export function newerRelease(latest:string,installed:string){
  const left=versionParts(latest),right=versionParts(installed);if(!left||!right||left.some(n=>!Number.isSafeInteger(n))||right.some(n=>!Number.isSafeInteger(n)))return false;
  for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i];
  return false;
}
export function readRelease(value:unknown):Release|null{
  if(!isRecord(value)||value.draft!==false||value.prerelease!==false||typeof value.tag_name!=='string')return null;
  const tag=value.tag_name,version=tag.replace(/^v/,'');if(!/^\d+\.\d+\.\d+$/.test(version)||!versionParts(version)||!Array.isArray(value.assets))return null;
  const assets={} as Release['assets'];
  for(const name of Object.keys(limits) as ReleaseFile[]){
    const matches=value.assets.filter((asset:unknown)=>isRecord(asset)&&asset.name===name);
    if(matches.length!==1)return null;
    const asset:unknown=matches[0];if(!isRecord(asset)||typeof asset.size!=='number'||asset.size<=0||asset.size>limits[name]||asset.browser_download_url!==`${RELEASE_DOWNLOAD}${tag}/${name}`)return null;
    assets[name]=asset.browser_download_url;
  }
  return {version,tag,body:typeof value.body==='string'?value.body:'',assets};
}
export function updateTitle(version:string){return `Update available for t3-obsidian (v${version})`;}
async function download(request:ReleaseRequest,url:string,limit:number){
  const response=await request(url);if(response.status!==200)throw Error(`GitHub returned ${response.status}. Try again later.`);
  if(!response.text.length||response.text.length>limit||new TextEncoder().encode(response.text).length>limit)throw Error('The release file is empty or too large.');
  return response.text;
}
export async function latestRelease(request:ReleaseRequest){const release=readRelease(JSON.parse(await download(request,RELEASE_API,512_000)) as unknown);if(!release)throw Error('The latest release is incomplete or unsupported.');return release;}
export async function releaseManifest(release:Release,request:ReleaseRequest,id:string,compatible:(version:string)=>boolean,mobile:boolean):Promise<UpdateManifest>{
  const manifest:unknown=JSON.parse(await download(request,release.assets['manifest.json'],limits['manifest.json']));
  if(!isRecord(manifest)||manifest.id!==id||manifest.version!==release.version||typeof manifest.minAppVersion!=='string'||!versionParts(manifest.minAppVersion))throw Error('The release manifest does not match this plugin and version.');
  if(!compatible(manifest.minAppVersion))throw Error(`Update Obsidian to ${manifest.minAppVersion} or later first.`);
  if(mobile&&manifest.isDesktopOnly===true)throw Error('This release requires desktop Obsidian.');
  return manifest as UpdateManifest;
}

export interface UpdateFiles {
  read(name:ReleaseFile):Promise<string|null>;
}

export type UpdateState={release:Release;busy:boolean;message:string};
export interface UpdateHost {
  installed():Promise<string>;
  latest():Promise<Release|null>;
  install(release:Release):Promise<void>;
  dismissed():unknown;
  dismiss(version:string):void;
  render(state:UpdateState|null):void;
  report(message:string):void;
}
export class PluginUpdates {
  private stopped=false;private checking?:Promise<void>;private lastCheck:number|undefined;private state:UpdateState|null=null;
  constructor(private host:UpdateHost,private now=()=>Date.now()){}
  check(manual=false):Promise<void>{
    if(this.stopped||this.state?.busy)return Promise.resolve();
    if(this.checking)return this.checking;
    if(!manual&&this.lastCheck!==undefined&&this.now()-this.lastCheck<6*60*60*1000)return Promise.resolve();
    this.lastCheck=this.now();
    const work=this.runCheck(manual);this.checking=work;void work.finally(()=>{if(this.checking===work)this.checking=undefined;});return work;
  }
  private async runCheck(manual:boolean){
    try{
      const release=await this.host.latest(),installed=await this.host.installed();if(this.stopped)return;
      if(release&&newerRelease(release.version,installed)){
        if(manual||this.host.dismissed()!==release.version)this.show({release,busy:false,message:updateTitle(release.version)});
        else this.show(null);
      }else {this.show(null);if(manual)this.host.report('T3 Code is up to date.');}
    }catch(error){if(manual&&!this.stopped)this.host.report(`Could not check for updates. ${error instanceof Error?error.message:'Try again later.'}`);}
  }
  async update(){
    const state=this.state;if(!state||state.busy||this.stopped)return;
    this.show({...state,busy:true,message:`Updating T3 Code to ${state.release.version}…`});
    try{await this.host.install(state.release);if(!this.stopped)this.show(null);}
    catch(error){if(!this.stopped)this.show({...state,busy:false,message:`Update failed. ${error instanceof Error?error.message:'Try again later.'}`});}
  }
  dismiss(){if(!this.state||this.state.busy||this.stopped)return;try{this.host.dismiss(this.state.release.version);this.show(null);}catch{this.host.report('Could not save the dismissed update. Try again.');}}
  private show(state:UpdateState|null){this.state=state;this.host.render(state);}
  dispose(){this.stopped=true;this.state=null;this.host.render(null);}
}
