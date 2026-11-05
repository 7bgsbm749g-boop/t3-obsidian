import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from './build-fixture';
import {builtinModules} from 'node:module';
import {webcrypto} from 'node:crypto';
import {runInNewContext} from './obsidian-context';
import {editorExternals,desktopTimersPlugin} from '../esbuild.config.mjs';

test('even direct desktop-adapter calls on mobile fail before loading any Node capability',async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
    export * from './src/connection/desktop';
    export * from './src/connection/content-hash-desktop';
    export * from './src/connection/desktop-timers';
    export * from './src/conversations/inline-file-cache-desktop';
    export * from './src/notes/note-command-desktop';
    export * from './src/app/event-host-desktop';
    export * from './src/storage/private-storage-desktop';
    export * from './src/responses/response-storage-desktop';
  `},bundle:true,write:false,format:'cjs',platform:'browser',target:'es2022',external:['obsidian',...editorExternals,'node:*',...builtinModules.filter(name=>name!=='buffer')],plugins:[desktopTimersPlugin()]});
  const module={exports:{} as any},attempts:string[]=[];
  runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,TextEncoder,TextDecoder,crypto:webcrypto,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},require:(name:string)=>{
    attempts.push(name);assert.equal(name,'obsidian','mobile must never evaluate a Node or desktop dependency');
    return {Platform:{isMobile:true,isDesktop:false}};
  }});
  const api=module.exports,files=api.localInlineFiles('/synthetic-vault','.obsidian/t3-code/inline/v1');
  const calls=[()=>api.desktopDefaults(),()=>api.desktopTimers(),()=>api.installDesktopContentHash(),()=>api.existingPrivateStorage('/synthetic-vault','.obsidian'),()=>api.ensurePrivateStorage('/synthetic-vault','.obsidian'),()=>api.registeredVaults('/synthetic-registry'),()=>api.inlineFileVersion('/synthetic-file'),()=>new api.DesktopInlineReadCache().read('/synthetic-file'),()=>files.read('.obsidian/t3-code/inline/v1/response.json'),()=>files.requests(),()=>files.list('.obsidian/t3-code/inline/v1/requests'),()=>api.NoteCommandServer.open('/synthetic-vault','.obsidian'),()=>api.EventHostServer.open({workspaceRoot:'/synthetic-vault'}),()=>api.requestJson('http://127.0.0.1','synthetic','/api/health')];
  for(const call of calls)await assert.rejects(async()=>call(),/requires? (?:Obsidian on )?desktop|require desktop/i);
  assert.ok(attempts.every(name=>name==='obsidian'));
});
