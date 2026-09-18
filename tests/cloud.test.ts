import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {beginLogin,pollLogin,refreshAccount,discoverMachines,CloudError,CLOUD} from '../cloud';
globalThis.indexedDB=indexedDB;
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
const response=(data:any,status=200)=>new Response(JSON.stringify(data),{status});
const account={accessToken:'cloud-access',refreshToken:'refresh-secret',expiresAt:Date.now()+300000,identity:'Account'};

test('OAuth device login handles pending, backoff, denial and token rotation without exposing secrets',async()=>{
 let calls=0;const mock=async(url:any,o:any)=>{calls++;assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');const body=new URLSearchParams(o.body);assert.equal(body.get('client_id'),CLOUD.clientId);return response({device_code:'private-device-code',user_code:'ABCD',verification_uri:'https://accounts.t3.codes/device',expires_in:600,interval:5});};
 const login=await beginLogin(mock as any);assert.equal(login.userCode,'ABCD');assert.ok(!login.verificationUrl.includes(login.deviceCode));
 await pollLogin(login,(()=>{throw Error('too soon');}) as any);login.nextPollAt=0;
 assert.equal(await pollLogin(login,(async()=>response({error:'authorization_pending'},400)) as any),null);login.nextPollAt=0;
 assert.equal(await pollLogin(login,(async()=>response({error:'slow_down'},400)) as any),null);assert.equal(login.interval,10000);login.nextPollAt=0;
 await assert.rejects(pollLogin(login,(async()=>response({error:'access_denied',error_description:'SECRET'},400)) as any),e=>e instanceof CloudError&&!e.message.includes('SECRET'));
 login.nextPollAt=0;const a=await pollLogin(login,(async()=>response({access_token:'new-access',refresh_token:'new-refresh',expires_in:300,token_type:'Bearer'})) as any);assert.equal(a?.refreshToken,'new-refresh');
 const refreshed=await refreshAccount({...account,expiresAt:0},(async(_u:any,o:any)=>{assert.equal(new URLSearchParams(o.body).get('refresh_token'),'refresh-secret');return response({access_token:'rotated',refresh_token:'rotated-refresh',expires_in:600,token_type:'bearer'});}) as any);assert.equal(refreshed.refreshToken,'rotated-refresh');
 await assert.rejects(beginLogin((async()=>response({device_code:'x',user_code:'x',verification_uri:'https://attacker.example',expires_in:600})) as any),/invalid_device_response/);
});

test('cloud discovery uses only the account token at the relay and rejects unsafe machine addresses',async()=>{
 const machine={environmentId:'env',name:'Laptop',url:'https://t3.example'};
 const mock=async(url:any,o:any)=>{assert.equal(url,CLOUD.relay+'/v1/environments');assert.equal(o.headers.Authorization,'Bearer cloud-access');assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');return response({environments:[{environmentId:'env',label:'Laptop',endpoint:{httpBaseUrl:machine.url}}]});};
 assert.deepEqual(await discoverMachines(account,mock as any),[machine]);
 await assert.rejects(discoverMachines(account,(async()=>response({environments:[{environmentId:'env',label:'Bad',endpoint:{httpBaseUrl:'http://private-server'}}]})) as any),/HTTPS/);
 assert.deepEqual(await discoverMachines(account,(async()=>response({environments:[]})) as any),[]);
});
