import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {randomUUID,webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {initialRegion} from '../inline-thread';

test('mobile palette stop all works without selection, while sending is busy, and reports an empty note',async()=>{
  const id=randomUUID(),failed=randomUUID(),commands=new Map<string,any>(),storage=new Map<string,any>(),notices:string[]=[];
  let value='Before'+initialRegion(id).text+initialRegion(failed).text.replace('Working','Error')+'After';
  const editor={getValue:()=>value,offsetToPos:(offset:number)=>offset,replaceRange:(text:string,from:number,to:number)=>{value=value.slice(0,from)+text+value.slice(to);}};
  const view={file:{path:'Mobile.md',extension:'md'},editor};
  class Base{}
  class Plugin{
    app={loadLocalStorage:(key:string)=>storage.get(key),saveLocalStorage:(key:string,data:any)=>storage.set(key,data),workspace:{onLayoutReady:()=>{},on:()=>{},getLeavesOfType:()=>[{view}]}};
    async loadData(){return {};}
    async saveData(){}
    addCommand(command:any){commands.set(command.id,command);}addSettingTab(){}registerEvent(){}
  }
  const api={Plugin,Platform:{isMobile:true},Modal:Base,FuzzySuggestModal:Base,PluginSettingTab:Base,Notice:class{constructor(text:string){notices.push(text);}}};
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},URL,TextEncoder,TextDecoder,crypto:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},setTimeout,clearTimeout,console},{timeout:5000});
  const plugin=new module.exports.default();await plugin.onload();
  const stops:string[]=[];plugin.inlineChat.hosted.stop=async(job:any)=>{stops.push(job.id);};plugin.busy=true;
  const command=commands.get('stop-all-responses');
  try{
    assert.equal(command.name,'Stop all T3 responses in current note');
    assert.equal(command.editorCheckCallback(true,editor,view),true);
    assert.deepEqual(stops,[]);assert.match(value,/Working/);
    assert.equal(command.editorCheckCallback(false,editor,view),true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.doesNotMatch(value,/t3-inline:|Working|Error|spinner/);assert.match(value,/Before/);assert.match(value,/After/);
    assert.deepEqual(stops.sort(),[id,failed].sort());assert.ok(notices.includes('Stopped 2 T3 responses in this note.'));
    command.editorCheckCallback(false,editor,view);await new Promise(resolve=>setImmediate(resolve));
    assert.ok(notices.includes('No active or failed T3 responses in this note.'));
    assert.equal(command.editorCheckCallback(true,editor,{file:null}),false);
    assert.equal(command.editorCheckCallback(true,editor,{file:{extension:'pdf'}}),false);
  }finally{plugin.onunload();}
});
