import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {readRelease,RELEASE_REPOSITORY} from '../src/app/plugin-updates';
const compiled=build({entryPoints:['src/app/update-install.ts'],bundle:true,platform:'browser',format:'cjs',write:false});
async function fixture(tag='0.0.451'){
 const module={exports:{} as any},files=new Map<string,string>([['plugins/t-three-code/manifest.json',JSON.stringify({id:'t-three-code',version:'0.0.450'})],['plugins/t-three-code/main.js','old'],['plugins/t-three-code/styles.css','old css'],['plugins/t-three-code/data.json','preserve settings']]),events:string[]=[],notices:string[]=[];
 const manifest={id:'t-three-code',version:'0.0.450',dir:'plugins/t-three-code'};
 const release=readRelease({tag_name:tag,draft:false,prerelease:false,assets:['main.js','manifest.json','styles.css'].map(name=>({name,size:20,browser_download_url:`https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/${name}`}))})!;
 const next={id:manifest.id,version:release.version,minAppVersion:'1.13.0'};
 const app:any={vault:{configDir:'.obsidian',adapter:{exists:async(p:string)=>files.has(p),read:async(p:string)=>files.get(p)}},plugins:{plugins:{'t-three-code':{manifest:{...manifest}}},installPlugin:async(repo:string,version:string,value:unknown)=>{
  events.push('native install');assert.equal(repo,RELEASE_REPOSITORY);assert.equal(version,tag);assert.deepEqual(JSON.parse(JSON.stringify(value)),next);
  files.set('plugins/t-three-code/manifest.json',JSON.stringify(next));app.plugins.plugins['t-three-code'].manifest={...next};
 }}};
 runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,TextEncoder,Error,require:()=>({Notice:class{constructor(text:string){notices.push(text);}},normalizePath:(p:string)=>p,Platform:{isMobile:false},requireApiVersion:()=>true})});
 const request=async(url:string)=>{assert.equal(url,release.assets['manifest.json']);events.push('download manifest.json');return {status:200,text:JSON.stringify(next)};};
 return {module,app,files,events,notices,release,manifest,next,request};
}
test('native installer receives the repository, exact release tag and checked manifest after saves',async()=>{
 for(const tag of ['0.0.451','v0.0.451']){
  const f=await fixture(tag);await f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>{f.events.push('prepare');},()=>true,f.request);
  assert.deepEqual(f.events,['download manifest.json','prepare','native install']);
  assert.equal(f.files.get('plugins/t-three-code/data.json'),'preserve settings');
 }
});
test('unload, save failure, newer install and absent host API cannot invoke the installer',async()=>{
 for(const mode of ['unloaded','save-failed','newer','unsupported']){
  const f=await fixture();if(mode==='newer')f.files.set('plugins/t-three-code/manifest.json',JSON.stringify({id:'t-three-code',version:'0.0.452'}));if(mode==='unsupported')f.app.plugins.installPlugin=null;
  await assert.rejects(f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>{if(mode==='save-failed')throw Error('Save pending');},()=>mode!=='unloaded',f.request));
  assert.equal(f.events.includes('native install'),false);
 }
});
test('concurrent installation or unload while saving is checked again before native installation',async()=>{
 for(const mode of ['changed','unloaded']){
  const f=await fixture();let alive=true;
  await assert.rejects(f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>{
   if(mode==='changed')f.files.set('plugins/t-three-code/manifest.json',JSON.stringify({...f.manifest,version:'0.0.452'}));else alive=false;
  },()=>alive,f.request),mode==='changed'?/changed/:/unloaded/);
  assert.equal(f.events.includes('native install'),false);
 }
});
test('manifest failure does not prepare saves or call the native installer',async()=>{
 const f=await fixture();await assert.rejects(f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>assert.fail('must not prepare'),()=>true,async()=>({status:503,text:'down'})),/503/);
 assert.deepEqual(f.events,[]);
});
test('native silent failure and disk/live version disagreement cannot report success',async()=>{
 for(const mode of ['no-op','disk-only','live-only']){
  const f=await fixture();f.app.plugins.installPlugin=async()=>{
   if(mode==='disk-only')f.files.set('plugins/t-three-code/manifest.json',JSON.stringify(f.next));
   if(mode==='live-only')f.app.plugins.plugins['t-three-code'].manifest={...f.next};
  };
  await assert.rejects(f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>{},()=>true,f.request),mode==='disk-only'?/Restart Obsidian/:/did not install/);
 }
});
test('a native install that leaves the old runtime loaded prepares again and uses the host reload methods',async()=>{
 const f=await fixture();f.app.plugins.installPlugin=async()=>{f.events.push('native install');f.files.set('plugins/t-three-code/manifest.json',JSON.stringify(f.next));};
 f.app.plugins.disablePlugin=async(id:string)=>{assert.equal(id,f.manifest.id);f.events.push('disable');};
 f.app.plugins.loadManifests=async()=>{f.events.push('manifests');};
 f.app.plugins.enablePlugin=async(id:string)=>{assert.equal(id,f.manifest.id);f.events.push('enable');f.app.plugins.plugins[id].manifest={...f.next};};
 await f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>{f.events.push('prepare');},()=>true,f.request);
 assert.deepEqual(f.events,['download manifest.json','prepare','native install','prepare','disable','manifests','enable']);
});
test('saves and concurrent updates are checked again before reloading native-installed files',async()=>{
 for(const mode of ['save-failed','changed','unloaded']){
  const f=await fixture();let prepares=0,alive=true;
  f.app.plugins.installPlugin=async()=>{f.files.set('plugins/t-three-code/manifest.json',JSON.stringify(f.next));};
  f.app.plugins.disablePlugin=async()=>assert.fail('must not reload');f.app.plugins.loadManifests=async()=>{};f.app.plugins.enablePlugin=async()=>{};
  await assert.rejects(f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>{
   if(++prepares!==2)return;
   if(mode==='save-failed')throw Error('Save pending');
   if(mode==='changed')f.files.set('plugins/t-three-code/manifest.json',JSON.stringify({...f.manifest,version:'0.0.452'}));else alive=false;
  },()=>alive,f.request),mode==='save-failed'?/Save pending/:mode==='changed'?/changed/:/unloaded/);
 }
});
test('retry after a blocked reload uses installed files and cannot downgrade a newer running version',async()=>{
 const f=await fixture();let prepares=0,installs=0;
 f.app.plugins.installPlugin=async()=>{installs++;f.files.set('plugins/t-three-code/manifest.json',JSON.stringify(f.next));};
 f.app.plugins.disablePlugin=async()=>{};f.app.plugins.loadManifests=async()=>{};
 f.app.plugins.enablePlugin=async()=>{f.app.plugins.plugins['t-three-code'].manifest={...f.next};};
 const prepare=async()=>{if(++prepares===2)throw Error('Save pending');};
 await assert.rejects(f.module.exports.updatePlugin(f.app,f.manifest,f.release,prepare,()=>true,f.request),/Save pending/);
 await f.module.exports.updatePlugin(f.app,f.manifest,f.release,prepare,()=>true,f.request);
 assert.equal(installs,1);assert.deepEqual(f.events,['download manifest.json']);
 f.app.plugins.plugins['t-three-code'].manifest.version='0.0.452';
 await assert.rejects(f.module.exports.updatePlugin(f.app,f.manifest,f.release,prepare,()=>true,f.request),/older/);
});
test('native rejection is retained and is visible even after the old plugin unloads',async()=>{
 const f=await fixture();let alive=true;f.app.plugins.installPlugin=async()=>{alive=false;throw Error('Native install failed');};
 await assert.rejects(f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>{},()=>alive,f.request),/Native install failed/);
 assert.deepEqual(f.notices,['Native install failed']);
});
test('successful self-update may unload the old plugin during the native call',async()=>{
 const f=await fixture();let alive=true;const install=f.app.plugins.installPlugin;
 f.app.plugins.installPlugin=async(...args:unknown[])=>{alive=false;await install(...args);};
 await f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>{},()=>alive,f.request);assert.deepEqual(f.notices,[]);
});
test('synthetic banner fixture bundles the product banner',async()=>{
 const result=await build({entryPoints:['tests/native/plugin-updates-lab.ts'],bundle:true,platform:'browser',format:'cjs',write:false,external:['node:*'],define:{UPDATE_LAB_REPORT:'"synthetic-results.jsonl"'}});assert.match(result.outputFiles[0].text,/t3-update-banner/);
});
test('real native update fixture bundles the product installer',async()=>{
 const result=await build({entryPoints:['tests/native/plugin-update-install-lab.ts'],bundle:true,platform:'browser',format:'cjs',write:false,external:['node:*'],define:{UPDATE_INSTALL_REPORT:'"native-results.jsonl"',UPDATE_INSTALL_CANDIDATE:'"candidate"'}});
 assert.match(result.outputFiles[0].text,/installPlugin\(/);
});
