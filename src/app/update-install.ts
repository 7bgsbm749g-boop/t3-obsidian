import {normalizePath,requestUrl,requireApiVersion,Platform,Notice,type App,type PluginManifest} from 'obsidian';
import {isRecord} from '../shared/values';
import {installRelease,newerRelease,releaseFiles,type Release,type ReleaseFile,type ReleaseRequest,type UpdateFiles} from './plugin-updates';

export const requestRelease=async(url:string)=>{const response=await requestUrl({url,headers:{Accept:url.includes('api.github.com')?'application/vnd.github+json':'application/octet-stream'},throw:false});return {status:response.status,text:response.text};};
export function updateStorage(app:App,manifest:PluginManifest):UpdateFiles{
  const directory=manifest.dir??`${app.vault.configDir}/plugins/${manifest.id}`;
  const path=(name:ReleaseFile)=>normalizePath(`${directory}/${name}`),adapter=app.vault.adapter;
  return {read:async name=>await adapter.exists(path(name))?adapter.read(path(name)):null,write:(name,text)=>adapter.write(path(name),text),remove:name=>adapter.remove(path(name))};
}
export async function installedVersion(storage:UpdateFiles,id:string){
  const raw=await storage.read('manifest.json'),manifest:unknown=raw?JSON.parse(raw):null;
  if(!isRecord(manifest)||manifest.id!==id||typeof manifest.version!=='string')throw Error('The installed plugin manifest could not be read.');
  return manifest.version;
}
interface PluginManager {
  loadManifests():Promise<void>;
  disablePlugin(id:string):Promise<void>;
  enablePlugin(id:string):Promise<void>;
  plugins:Record<string,{manifest?:PluginManifest}|undefined>;
}
/** Keep the private host reload API behind a capability check. Downloads and
 * writes use public cross-platform Obsidian APIs; settings are never replaced. */
export async function updatePlugin(app:App,manifest:PluginManifest,release:Release,prepare:()=>Promise<void>,alive:()=>boolean,request:ReleaseRequest=requestRelease){
  const plugins=(app as App&{plugins?:PluginManager}).plugins;
  if(!plugins||typeof plugins.loadManifests!=='function'||typeof plugins.disablePlugin!=='function'||typeof plugins.enablePlugin!=='function')throw Error('This Obsidian version cannot reload the plugin. Update it through Community plugins.');
  const storage=updateStorage(app,manifest),before=await installedVersion(storage,manifest.id);
  const files=await releaseFiles(release,request,manifest.id,requireApiVersion,Platform.isMobile);
  await installRelease(files,storage,async()=>{
    if(!alive())throw Error('The plugin was unloaded.');
    if(await installedVersion(storage,manifest.id)!==before)throw Error('The installed plugin changed during the download. Check again.');
    if(!newerRelease(release.version,before))throw Error('This release is already installed or older than your installed version.');
    await prepare();if(!alive())throw Error('The plugin was unloaded.');
  });
  // No application reload or enabled-plugin list change is needed.
  try{
    await plugins.disablePlugin(manifest.id);await plugins.loadManifests();await plugins.enablePlugin(manifest.id);
    if(plugins.plugins[manifest.id]?.manifest?.version!==release.version)throw Error('The new plugin did not load.');
  }catch{
    const detail='The update files are installed. Restart Obsidian to load the update.';
    // The old banner has already unloaded if enabling the new plugin fails.
    new Notice(detail,0);throw Error(detail);
  }
}
