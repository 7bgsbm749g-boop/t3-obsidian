import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configureBridge,runBridge,sendRequest} from '../src/app/bridge';

test('all platforms refuse retired transports without network access or local execution',async()=>{
 configureBridge({mobile:true});
 for(const connection of [{transport:'https' as const,url:'https://old.example',executable:'DO NOT RUN',host:'local'},{executable:'DO NOT RUN',host:'laptop'}]){
  await assert.rejects(runBridge(connection,['projects']),/Reconnect .*T3 Connect/);
  await assert.rejects(sendRequest({id:'saved-id',project:{id:'p',title:'P',workspaceRoot:'/'},title:'Old note',prompt:'Keep me',connection}),/Reconnect .*T3 Connect/);
 }
 await assert.rejects(runBridge({executable:'DO NOT RUN',host:'local'},['projects']),/Reconnect .*T3 Connect/);
});

test('the shipped plugin has no native app reload command or remote reload capability',async()=>{
 const bundle=await readFile(new URL('../dist/main.js',import.meta.url),'utf8');
 assert.equal(bundle.includes('app:reload'),false,'Application reloads must remain outside the plugin.');
 assert.equal(bundle.includes('reload-client'),false,'The retired command must not enter the shipped bundle.');
});
