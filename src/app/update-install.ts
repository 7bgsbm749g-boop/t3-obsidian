import {normalizePath,requestUrl,requireApiVersion,Platform,Notice,type App,type PluginManifest} from 'obsidian';
import {isRecord} from '../shared/values';
import {newerRelease,releaseManifest,RELEASE_REPOSITORY,type Release,type ReleaseFile,type ReleaseRequest,type UpdateFiles,type UpdateManifest} from './plugin-updates';

export const requestRelease=async(url:string)=>{const response=await requestUrl({url,headers:{Accept:url.includes('api.github.com')?'application/vnd.github+json':'application/octet-stream'},throw:false});return {status:response.status,text:response.text};};
export function updateStorage(app:App,manifest:PluginManifest):UpdateFiles{
  const directory=manifest.dir??`${app.vault.configDir}/plugins/${manifest.id}`;
  const path=(name:ReleaseFile)=>normalizePath(`${directory}/${name}`),adapter=app.vault.adapter;
  return {read:async name=>await adapter.exists(path(name))?adapter.read(path(name)):null};
}
export async function installedVersion(storage:UpdateFiles,id:string){
  const raw=await storage.read('manifest.json'),manifest:unknown=raw?JSON.parse(raw):null;
  if(!isRecord(manifest)||manifest.id!==id||typeof manifest.version!=='string')throw Error('The installed plugin manifest could not be read.');
  return manifest.version;
}
interface PluginManager {
  installPlugin(repository:string,tag:string,manifest:UpdateManifest):Promise<unknown>;
  disablePlugin?(id:string):Promise<void>;
  loadManifests?():Promise<void>;
  enablePlugin?(id:string):Promise<void>;
  plugins:Record<string,{manifest?:PluginManifest}|undefined>;
}
/** Obsidian owns runtime downloads and installation. Its internal API can return
 * after a failure notice or leave the old runtime loaded; verify both versions. */
export async function updatePlugin(app:App,manifest:PluginManifest,release:Release,prepare:()=>Promise<void>,alive:()=>boolean,request:ReleaseRequest=requestRelease){
  const plugins=(app as App&{plugins?:PluginManager}).plugins;
  if(!plugins||typeof plugins.installPlugin!=='function')throw Error('This Obsidian version cannot install the update here. Update it through Community plugins.');
  const storage=updateStorage(app,manifest),before=await installedVersion(storage,manifest.id);
  const loaded=plugins.plugins[manifest.id]?.manifest?.version;
  const retryReload=before===release.version&&!!loaded&&newerRelease(release.version,loaded);
  if(newerRelease(loaded??'',release.version)||!retryReload&&!newerRelease(release.version,before))throw Error('This release is already installed or older than your installed version.');
  try{
    if(!retryReload){
      const next=await releaseManifest(release,request,manifest.id,requireApiVersion,Platform.isMobile);
      if(!alive())throw Error('The plugin was unloaded.');
      await prepare();if(!alive())throw Error('The plugin was unloaded.');
      if(await installedVersion(storage,manifest.id)!==before)throw Error('The installed plugin changed during the update. Check again.');
      if(!alive())throw Error('The plugin was unloaded.');
      await plugins.installPlugin(RELEASE_REPOSITORY,release.tag,next);
    }
    if(await installedVersion(storage,manifest.id)!==release.version)throw Error('Obsidian did not install the requested version. Try again or update it through Community plugins.');
    // Some host versions install files without reloading an enabled plugin.
    if(plugins.plugins[manifest.id]?.manifest?.version!==release.version&&alive()&&typeof plugins.disablePlugin==='function'&&typeof plugins.loadManifests==='function'&&typeof plugins.enablePlugin==='function'){
      await prepare();if(!alive())throw Error('The plugin was unloaded.');
      if(await installedVersion(storage,manifest.id)!==release.version)throw Error('The installed plugin changed before reloading. Check again.');
      if(!alive())throw Error('The plugin was unloaded.');
      await plugins.disablePlugin(manifest.id);await plugins.loadManifests();await plugins.enablePlugin(manifest.id);
    }
    if(plugins.plugins[manifest.id]?.manifest?.version!==release.version)throw Error('The update files are installed. Restart Obsidian to load the update.');
    if(await installedVersion(storage,manifest.id)!==release.version)throw Error('The installed plugin changed while reloading. Check again.');
  }catch(error){
    // A self-update can unload this banner before an installation/load failure.
    if(!alive())new Notice(error instanceof Error?error.message:'The update could not be verified. Restart Obsidian and check the installed version.',0);
    throw error;
  }
}
