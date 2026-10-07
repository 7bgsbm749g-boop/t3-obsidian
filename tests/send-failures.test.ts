import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendSendFailure,type SendFailure} from '../send-failures';
test('failure log bounds retention, keeps nested transport causes and RPC kinds, and removes credentials',()=>{
  const error=Object.assign(Error('socket failed at https://private.example/?token=secret'),{kind:'ProjectReadFileError',cause:Error('Bearer secret-token ticket=secret')});
  const failure:SendFailure={at:'now',stage:'response-registration',elapsedMs:17,delivery:'not-started',requestId:'request',error};
  let log:SendFailure[]=[];for(let i=0;i<80;i++)log=appendSendFailure(log,{...failure,requestId:String(i)});
  assert.equal(log.length,64);assert.equal(log[0].requestId,'16');assert.equal(log.at(-1)!.requestId,'79');
  const bytes=JSON.stringify(log);assert.match(bytes,/ProjectReadFileError|socket failed|response-registration/);assert.doesNotMatch(bytes,/private\.example|secret-token|ticket=secret/);
});
