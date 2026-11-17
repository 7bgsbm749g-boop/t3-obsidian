import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installRelease,latestRelease,newerRelease,PluginUpdates,readRelease,releaseFiles,RELEASE_API,RELEASE_REPOSITORY,type ReleaseFile,type UpdateState} from '../src/app/plugin-updates';
const names:ReleaseFile[]=['main.js','styles.css','manifest.json'];
const metadata=(version='0.0.451')=>({tag_name:version,draft:false,prerelease:false,assets:names.map(name=>({name,size:100,browser_download_url:`https://github.com/${RELEASE_REPOSITORY}/releases/download/${version}/${name}`}))});
const release=readRelease(metadata())!;
const files={'main.js':'new executable','styles.css':'new styles','manifest.json':JSON.stringify({id:'t-three-code',version:release.version,minAppVersion:'1.13.0',isDesktopOnly:false})};

test('numeric versions do not sort lexically or downgrade a newer test build',()=>{
 assert.equal(newerRelease('0.0.100','0.0.99'),true);assert.equal(newerRelease('0.0.99','0.0.100'),false);
 for(const version of ['0.0.451','0.0.451-feature','0.0.452-feature','unknown'])assert.equal(newerRelease('0.0.451',version),false);
 assert.equal(newerRelease('0.0.451','0.0.450-feature'),true);assert.equal(newerRelease('0.0.451','0.0.450+bad'),false);
});
test('only complete stable releases from the fixed repository are eligible',()=>{
 assert.ok(release);assert.equal(readRelease({...metadata(),draft:true}),null);assert.equal(readRelease({...metadata(),prerelease:true}),null);
 assert.equal(readRelease(metadata('0.0.451-test')),null);assert.equal(readRelease({...metadata(),assets:metadata().assets.slice(1)}),null);
 for(const patch of [{browser_download_url:'https://example.com/main.js'},{size:100_000_000},{size:0}]){const value=metadata();Object.assign(value.assets[0],patch);assert.equal(readRelease(value),null);}
 const duplicate=metadata();duplicate.assets.push(duplicate.assets[0]);assert.equal(readRelease(duplicate),null);
});
test('GitHub release body is preserved verbatim and absent or invalid notes are empty',()=>{
 const body='Description.\n\n## What’s Changed\n- Fix one.\n- Fix two.\n';assert.equal(readRelease({...metadata(),body})!.body,body);
 for(const body of [undefined,null,42,{}])assert.equal(readRelease({...metadata(),body})!.body,'');
});
test('release download rejects API failures and malformed metadata',async()=>{
 let url='';assert.equal((await latestRelease(async value=>{url=value;return {status:200,text:JSON.stringify(metadata())};})).version,release.version);assert.equal(url,RELEASE_API);
 await assert.rejects(latestRelease(async()=>({status:429,text:'rate limited'})),/429/);
 await assert.rejects(latestRelease(async()=>({status:200,text:'{}'})),/incomplete/);
});
test('all downloads finish before installation; reject wrong identity, version, app and platform',async()=>{
 const calls:string[]=[];const request=async(url:string)=>{calls.push(url);return {status:200,text:files[names.find(name=>url.endsWith(name))!]};};
 assert.deepEqual(await releaseFiles(release,request,'t-three-code',()=>true,false),files);assert.ok(calls[0].endsWith('manifest.json'));
 for(const patch of [{id:'other'},{version:'0.0.452'},{minAppVersion:'bad'},{minAppVersion:'9.0.0'},{isDesktopOnly:true}]){
  let main=false;await assert.rejects(releaseFiles(release,async url=>{main ||=url.endsWith('main.js');return {status:200,text:JSON.stringify({...JSON.parse(files['manifest.json']),...patch})};},'t-three-code',version=>version!=='9.0.0',true));assert.equal(main,false);
 }
 await assert.rejects(releaseFiles(release,async url=>url.endsWith('main.js')?{status:503,text:'down'}:request(url),'t-three-code',()=>true,false),/503/);
});
function storage(){const data=new Map<string,string>(names.map(name=>[name,'old '+name]));data.set('data.json','user settings');let fail:string|undefined;const writes:string[]=[];return {data,writes,fail:(name:string)=>{fail=name;},adapter:{read:async(name:ReleaseFile)=>data.get(name)??null,write:async(name:ReleaseFile,text:string)=>{writes.push(name);data.set(name,text);if(name===fail){fail=undefined;throw Error('disk full');}},remove:async(name:ReleaseFile)=>{data.delete(name);}}};}
test('commit manifest last, preserve settings and restore all runtime files after partial write failure',async()=>{
 const good=storage();await installRelease(files,good.adapter,async()=>{});assert.deepEqual(good.writes,names);assert.equal(good.data.get('data.json'),'user settings');
 for(const name of names){const f=storage(),before=new Map(f.data);f.fail(name);await assert.rejects(installRelease(files,f.adapter,async()=>{}),/disk full/);assert.deepEqual(f.data,before);}
});
test('readiness failures and concurrent Sync edits prevent any file writes',async()=>{
 const f=storage();await assert.rejects(installRelease(files,f.adapter,async()=>{throw Error('save pending');}),/save pending/);assert.deepEqual(f.writes,[]);
 await assert.rejects(installRelease(files,f.adapter,async()=>{f.data.set('main.js','synced runtime');}),/changed/);assert.deepEqual(f.writes,[]);
});
test('verification detects lost writes and reports incomplete rollback',async()=>{
 const f=storage();let drop=true;const adapter={...f.adapter,write:async(name:ReleaseFile,text:string)=>{if(drop){drop=false;return;}await f.adapter.write(name,text);}};
 await assert.rejects(installRelease(files,adapter,async()=>{}),/verify/);
 const broken={...f.adapter,write:async()=>{throw Error('disk unavailable');}};await assert.rejects(installRelease(files,broken,async()=>{}),/could not restore/);
});
function controller(){let clock=0,version='0.0.450',dismissed:unknown,checks=0,installs=0,fail=false,latest=release;const rendered:(UpdateState|null)[]=[],notices:string[]=[];const updates=new PluginUpdates({installed:async()=>version,latest:async()=>{checks++;if(fail)throw Error('offline');return latest;},dismissed:()=>dismissed,dismiss:v=>{dismissed=v;},render:s=>rendered.push(s),report:s=>notices.push(s),install:async()=>{installs++;if(fail)throw Error('download failed');}},()=>clock);return {updates,rendered,notices,checks:()=>checks,installs:()=>installs,setFail:(v:boolean)=>{fail=v;},setVersion:(v:string)=>{version=v;},setRelease:(v:string)=>{latest=readRelease(metadata(v))!;},advance:()=>{clock+=6*60*60*1000;}};}
test('startup/focus checks coalesce and throttle; dismiss survives checks but not the next release',async()=>{
 const f=controller();await Promise.all([f.updates.check(),f.updates.check()]);assert.equal(f.checks(),1);assert.equal(f.rendered.at(-1)?.release.version,release.version);assert.equal(f.rendered.at(-1)?.message,'Update available for t3-obsidian (v0.0.451)');
 f.updates.dismiss();assert.equal(f.rendered.at(-1),null);await f.updates.check();assert.equal(f.checks(),1);
 f.advance();await f.updates.check();assert.equal(f.rendered.at(-1),null);await f.updates.check(true);assert.equal(f.rendered.at(-1)?.release.version,release.version);
 f.updates.dismiss();f.setRelease('0.0.452');f.advance();await f.updates.check();assert.equal(f.rendered.at(-1)?.release.version,'0.0.452');
});
test('offline background checks stay quiet; manual retry and errors stay available',async()=>{
 const f=controller();f.setFail(true);await f.updates.check();assert.equal(f.notices.length,0);await f.updates.check(true);assert.match(f.notices[0],/offline/);
 f.setFail(false);await f.updates.check(true);f.setFail(true);await f.updates.update();assert.match(f.rendered.at(-1)!.message,/download failed/);assert.equal(f.rendered.at(-1)!.busy,false);
 f.setFail(false);await f.updates.update();assert.equal(f.rendered.at(-1),null);assert.equal(f.installs(),2);
 f.setVersion('0.0.451');await f.updates.check(true);assert.match(f.notices.at(-1)!,/up to date/);
});
test('unload drops late checks and prevents further installs',async()=>{
 let resolve!:(value:typeof release)=>void;const rendered:unknown[]=[];let installed=0;const updates=new PluginUpdates({installed:async()=>{installed++;return '0.0.450';},latest:()=>new Promise(r=>resolve=r),install:async()=>assert.fail('disposed'),dismissed:()=>null,dismiss:()=>assert.fail('disposed'),render:s=>rendered.push(s),report:()=>assert.fail('disposed')});
 const work=updates.check();updates.dispose();resolve(release);await work;await updates.update();await updates.check(true);assert.deepEqual(rendered,[null]);assert.equal(installed,1);
});
test('busy banner rejects duplicate update clicks and dismiss until completion',async()=>{
 let finish!:()=>void,installs=0,dismissals=0;const updates=new PluginUpdates({installed:async()=> '0.0.450',latest:async()=>release,install:()=>{installs++;return new Promise<void>(r=>finish=r);},dismissed:()=>null,dismiss:()=>{dismissals++;},render:()=>{},report:()=>{}});
 await updates.check();const work=updates.update();await updates.update();updates.dismiss();assert.equal(installs,1);assert.equal(dismissals,0);finish();await work;
});
