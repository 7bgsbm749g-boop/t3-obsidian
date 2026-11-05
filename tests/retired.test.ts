import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureBridge,runBridge,sendRequest} from '../src/app/bridge';

test('all platforms refuse retired transports without network access or local execution',async()=>{
 configureBridge({mobile:true});
 for(const connection of [{transport:'https' as const,url:'https://old.example',executable:'DO NOT RUN',host:'local'},{executable:'DO NOT RUN',host:'laptop'}]){
  await assert.rejects(runBridge(connection,['projects']),/Reconnect .*T3 Connect/);
  await assert.rejects(sendRequest({id:'saved-id',project:{id:'p',title:'P',workspaceRoot:'/'},title:'Old note',prompt:'Keep me',connection}),/Reconnect .*T3 Connect/);
 }
 await assert.rejects(runBridge({executable:'DO NOT RUN',host:'local'},['projects']),/Reconnect .*T3 Connect/);
});
