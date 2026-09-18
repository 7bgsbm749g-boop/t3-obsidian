import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureBridge,runBridge,sendRequest} from '../bridge';

test('retired transports fail without calling network or a subprocess; mobile refuses local sends',async()=>{
 configureBridge({mobile:true});
 for(const connection of [{transport:'https' as const,url:'https://old.example',executable:'DO NOT RUN',host:'local'},{executable:'DO NOT RUN',host:'laptop'}]){
  await assert.rejects(runBridge(connection,['projects']),/old companion mode was removed/);
  await assert.rejects(sendRequest({id:'saved-id',project:{id:'p',title:'P',workspaceRoot:'/'},title:'Old note',prompt:'Keep me',connection}),/old companion mode was removed/);
 }
 await assert.rejects(runBridge({executable:'DO NOT RUN',host:'local'},['projects']),/local T3 connection/);
});
