import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendSendFailure,sendFailureLog,type SendFailure} from '../send-failures';
import {T3RpcError} from '../t3-rpc';
test('failure log bounds retention, keeps nested transport causes and RPC kinds, and removes credentials',()=>{
  const error=Object.assign(Error('socket failed at https://private.example/?token=secret'),{kind:'ProjectReadFileError',cause:Error('Bearer secret-token ticket=secret')});
  const failure:SendFailure={at:'now',stage:'response-registration',elapsedMs:17,delivery:'not-started',requestId:'request',error};
  let log:SendFailure[]=[];for(let i=0;i<80;i++)log=appendSendFailure(log,{...failure,requestId:String(i)});
  assert.equal(log.length,64);assert.equal(log[0].requestId,'16');assert.equal(log.at(-1)!.requestId,'79');
  const bytes=JSON.stringify(log);assert.match(bytes,/ProjectReadFileError|socket failed|response-registration/);assert.doesNotMatch(bytes,/private\.example|secret-token|ticket=secret/);
});
test('SSH failure log export is bounded, filtered, redacted and leaves stored entries unchanged',()=>{
 const saved=Array.from({length:80},(_,i)=>({at:new Date(Date.UTC(2026,9,9,17,i)).toISOString(),stage:'dispatch',elapsedMs:i,delivery:'unconfirmed',requestId:String(i),prompt:'private writing',error:{message:'Bearer secret https://private.example',cause:{message:'token=private',text:'private writing'},text:'private writing'}}));
 const original=JSON.stringify(saved),log=sendFailureLog(saved,'2.36.6','device','2026-10-09T17:40:00Z');
 assert.equal(log.failures.length,40);assert.equal(log.failures[0].requestId,'40');
 assert.equal(sendFailureLog(saved,'2.36.6','device').failures.length,64);
 assert.doesNotMatch(JSON.stringify(log),/private|secret|writing/);
 assert.equal(JSON.stringify(saved),original);assert.equal(log.deviceId,'device');assert.equal(log.pluginVersion,'2.36.6');
 assert.deepEqual(sendFailureLog(undefined,'2.36.6','device').failures,[]);
});
test('remote authorization failures retain the required permission and method without server secrets',()=>{
 const error=new T3RpcError('EnvironmentAuthorizationError','filesystem:read','projects.readFile');
 const [failure]=appendSendFailure([],{at:'now',stage:'response-registration',elapsedMs:10,delivery:'not-started',error});
 assert.equal((failure.error as any).requiredPermission,'filesystem:read');assert.equal((failure.error as any).rpcMethod,'projects.readFile');assert.match((failure.error as any).message,/Reconnect/);
});
