import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {readRelease,RELEASE_REPOSITORY} from '../src/app/plugin-updates';
const compiled=build({entryPoints:['src/app/update-install.ts'],bundle:true,platform:'browser',format:'cjs',write:false});
async function fixture(){
 const module={exports:{} as any},files=new Map<string,string>([['plugins/t-three-code/manifest.json',JSON.stringify({id:'t-three-code',version:'0.0.450'})],['plugins/t-three-code/main.js','old'],['plugins/t-three-code/styles.css','old css'],['plugins/t-three-code/data.json','preserve settings']]),events:string[]=[];let writeFailure=false;
 const app:any={vault:{configDir:'.obsidian',adapter:{exists:async(p:string)=>files.has(p),read:async(p:string)=>files.get(p),write:async(p:string,v:string)=>{events.push('write '+p.split('/').at(-1));if(writeFailure)throw Error('write failed');files.set(p,v);},remove:async(p:string)=>{files.delete(p);}}},plugins:{plugins:{'t-three-code':{manifest:{version:'0.0.450'}}},disablePlugin:async(id:string)=>{assert.equal(id,'t-three-code');events.push('disable');},loadManifests:async()=>{events.push('manifests');},enablePlugin:async()=>{events.push('enable');app.plugins.plugins['t-three-code'].manifest.version='0.0.451';}}};
 runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,TextEncoder,require:()=>({Notice:class{},normalizePath:(p:string)=>p,Platform:{isMobile:false},requireApiVersion:()=>true})});
 const release=readRelease({tag_name:'0.0.451',draft:false,prerelease:false,assets:['main.js','manifest.json','styles.css'].map(name=>({name,size:20,browser_download_url:`https://github.com/${RELEASE_REPOSITORY}/releases/download/0.0.451/${name}`}))})!;
 const manifest={id:'t-three-code',version:'0.0.450',dir:'plugins/t-three-code'};
 const request=async(url:string)=>{events.push('download '+url.split('/').at(-1));return {status:200,text:url.endsWith('manifest.json')?JSON.stringify({id:manifest.id,version:release.version,minAppVersion:'1.13.0'}):'new runtime'};};
 return {module,app,files,events,release,manifest,request,failWrites:()=>{writeFailure=true;}};
}
test('native adapter downloads all assets, prepares saves, preserves settings and reloads only this plugin',async()=>{
 const f=await fixture();await f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>{f.events.push('prepare');},()=>true,f.request);
 assert.deepEqual(f.events,['download manifest.json','download main.js','download styles.css','prepare','write main.js','write styles.css','write manifest.json','disable','manifests','enable']);
 assert.equal(f.files.get('plugins/t-three-code/data.json'),'preserve settings');
});
test('unload, save failure, synced newer version and absent host API cannot write or reload',async()=>{
 for(const mode of ['unloaded','save-failed','newer','unsupported']){
  const f=await fixture();if(mode==='newer')f.files.set('plugins/t-three-code/manifest.json',JSON.stringify({id:'t-three-code',version:'0.0.452'}));if(mode==='unsupported')f.app.plugins.disablePlugin=null;
  await assert.rejects(f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>{if(mode==='save-failed')throw Error('Save pending');},()=>mode!=='unloaded',f.request));
  assert.equal(f.events.some(e=>e.startsWith('write')||e==='disable'),false);
 }
});
test('a failed plugin enable gives a restart instruction and retains installed files',async()=>{
 const f=await fixture();f.app.plugins.enablePlugin=async()=>{throw Error('load failed');};
 await assert.rejects(f.module.exports.updatePlugin(f.app,f.manifest,f.release,async()=>{},()=>true,f.request),/Restart Obsidian/);
 assert.match(f.files.get('plugins/t-three-code/manifest.json')!,/0.0.451/);
});

test('native update fixture bundles the product installer and banner',async()=>{
 const result=await build({entryPoints:['tests/native/plugin-updates-lab.ts'],bundle:true,platform:'browser',format:'cjs',write:false,external:['node:*'],define:{UPDATE_LAB_REPORT:'"synthetic-results.jsonl"'}});assert.match(result.outputFiles[0].text,/t3-update-banner/);
});
