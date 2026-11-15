// Measures production settings code with synthetic history and in-memory IO.
import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const source=resolve(process.argv[2]??'.'),output=process.argv[3];if(!output)throw Error('Supply SOURCE_ROOT and external report JSON.');
const code=await readFile(join(source,'dist/main.js'),'utf8'),scratch=await mkdtemp(join(tmpdir(),'t3-settings-benchmark-'));
try{
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
import {runInNewContext} from './tests/obsidian-context';
import {indexedDB} from 'fake-indexeddb';
import {randomUUID,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {loadSmartSend,rememberResponse} from './src/notes/smart-send';
const code=readFileSync(${JSON.stringify(join(source,'dist/main.js'))},'utf8');
class Base{}
async function fixture(history){
 let current={vaultId:randomUUID(),smartSend:history},saves=0,bytes=0,local={deviceId:randomUUID(),mode:'direct'};
 class Plugin{app={loadLocalStorage:()=>local,saveLocalStorage:(_k,v)=>local=v,workspace:{onLayoutReady(){},on(){return {};}}};loadData=async()=>current;saveData=async value=>{current=value;saves++;bytes+=Buffer.byteLength(JSON.stringify(value));};addSettingTab(){}registerEvent(){}addCommand(){}register(){}}
 const module={exports:{}};runInNewContext(code,{module,exports:module.exports,require:name=>{if(name!=='obsidian')throw Error('Unexpected runtime import');return {Plugin,Platform:{isMobile:true},Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base};},indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},URL,TextEncoder,TextDecoder,AbortController,crypto:webcrypto,setTimeout,clearTimeout,console},{timeout:10000});
 const plugin=new module.exports.default();await plugin.onload();return {plugin,saves:()=>saves,bytes:()=>bytes,current:()=>current};
}
(async()=>{
 const data=loadSmartSend(undefined);let seed=1234567;const randomText=()=>{let text='';for(let i=0;i<300000;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;text+='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[(seed>>>0)&63];}return text;};
 for(let n=0;n<8;n++)await rememberResponse(data,'Synthetic.md','old-'+n,randomText(),'','',0);
 const runs=[];for(let n=0;n<3;n++){
  const h=await fixture(JSON.parse(JSON.stringify(data))),p=h.plugin,initialSaves=h.saves(),initialBytes=h.bytes(),start=performance.now();
  const change=()=>rememberResponse(p.smartData(),'Synthetic.md','new-'+n,'New synthetic generated body.','','',0);
  if(typeof p.retainSmartChange==='function')await p.retainSmartChange(change);else if(await change())await p.save(true);
  p.settings.threadTitleGeneration='always';await p.save(true);
  if(Object.keys(h.current().smartSend.responses).length!==9)throw Error('History was lost');
  runs.push({elapsedMs:performance.now()-start,sharedWrites:h.saves()-initialSaves,compactSerializedBytesWritten:h.bytes()-initialBytes,allResponsesRetained:true});
 }
 console.log(JSON.stringify({syntheticOnly:true,scope:'Production save and provenance paths; in-memory Plugin IO and IndexedDB; excludes filesystem and network time',fixtureSmartSendBytes:Buffer.byteLength(JSON.stringify(data)),runs,medianMs:runs.map(r=>r.elapsedMs).sort((a,b)=>a-b)[1],peakRssKiB:process.resourceUsage().maxRSS},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
`},bundle:true,platform:'node',format:'cjs',write:false,define:{'import.meta.url':JSON.stringify(pathToFileURL(resolve('tests/obsidian-context.ts')).href)},logLevel:'silent'});
 const file=join(scratch,'benchmark.cjs');await writeFile(file,result.outputFiles[0].contents);
 const report=JSON.parse(execFileSync(process.execPath,[file],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024}));report.productionBundleSHA256=createHash('sha256').update(code).digest('hex');report.measuredAt=new Date().toISOString();
 await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));
}finally{await rm(scratch,{recursive:true,force:true});}
