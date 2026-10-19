import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {EditorState,StateField} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {renderHtmlResult} from '../html-results';
import {reference} from '../tests/fixtures/html-result';

// Synthetic CodeMirror transactions only: no native client, vault, network,
// credentials, or provider dispatch. Run unchanged before and after a fix.
async function main(){
 const runtime=createRequire(import.meta.url),live=StateField.define({create:()=>true,update:value=>value}),module={exports:{} as any};
 const bundle=await build({stdin:{contents:"export {HtmlResultViews} from './html-result-view';",resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian','@codemirror/*','@lezer/common']});
 runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Modal:class{},MarkdownRenderChild:class{},editorLivePreviewField:live}:runtime(id),TextEncoder,TextDecoder,URL,console});
 const views=new module.exports.HtmlResultViews({workspace:{on:()=>({})}},{dispose(){}});let extension:any;
 views.install({registerMarkdownCodeBlockProcessor(){},registerEditorExtension:(value:any)=>{extension=value;},registerEvent(){},register(){}});
 const unit='Synthetic paragraph with **bold**, `code`, and [link](https://example.test).\n\n';
 const prose=unit.repeat(Math.ceil(52*1024/unit.length)).slice(0,52*1024),middle=prose.lastIndexOf('\n\n',prose.length/2)+2;
 const block=renderHtmlResult(reference),withReference=prose.slice(0,middle)+block+'\n\n'+prose.slice(middle);
 const measurements=[];
 for(const [name,text] of [['without-reference',prose],['one-reference',withReference]]){
  for(const location of ['start','before-reference','end']){
   const started=performance.now();let state=EditorState.create({doc:text,extensions:[live,extension]});const initialMs=performance.now()-started;
   const samples:number[]=[];let widgets=0;
   for(let index=0;index<28;index++){
    const from=location==='start'?0:location==='end'?state.doc.length-index%2:middle-3;
    const start=performance.now();state=state.update({changes:index%2?{from,to:from+1,insert:''}:{from,insert:'x'}}).state;
    const elapsed=performance.now()-start;if(index>=4)samples.push(elapsed);
    widgets=0;for(const set of state.facet(EditorView.decorations))if(typeof set!=='function')widgets+=set.size;
    if(widgets!==(name==='one-reference'?1:0))throw Error('Benchmark lost the expected HTML widget');
   }
   const sorted=[...samples].sort((a,b)=>a-b);
   measurements.push({name,location,characters:text.length,widgets,initialMs,samplesMs:samples,minimumMs:sorted[0],medianMs:sorted[12],p95Ms:sorted[22],maximumMs:sorted.at(-1)});
  }
 }
 const result={label:process.argv[2]??'unlabelled',at:new Date().toISOString(),node:process.version,platform:process.platform,architecture:process.arch,fixture:'52 KiB Markdown prose; one immutable synthetic HTML reference; 4 warmup + 24 measured alternating insert/delete transactions per location',measurements};
 const json=JSON.stringify(result,null,2)+'\n';if(process.argv[3])await writeFile(process.argv[3],json);process.stdout.write(json);
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
