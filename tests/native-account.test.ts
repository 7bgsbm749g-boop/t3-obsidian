import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beginEmailLogin,verifyEmailLogin,nativeRelayAccount,revokeNativeAccount} from '../native-account';
import {signInRequired} from '../sign-in-state';
const reply=(response:any,token='client-secret',status=200,client?:any)=>new Response(JSON.stringify({response,...(client?{client}:{})}),{status,headers:{authorization:token}});
const session={id:'sess_1',status:'active',user:{id:'user_1'}};

test('native email sign-in rotates client credentials, uses only email OTP, and obtains the relay template token',async()=>{
 const calls:string[]=[];let number=0;
 const fetcher=async(url:any,o:any)=>{
  const u=new URL(url);assert.equal(u.origin,'https://clerk.t3.codes');assert.equal(u.searchParams.get('_is_native'),'1');assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');
  calls.push(u.pathname);const body=new URLSearchParams(o.body);number++;
  if(number===1){assert.equal(o.headers.Authorization,undefined);return reply({sessions:[]},'initial-secret');}
  if(number===2){assert.equal(o.headers.Authorization,'Bearer initial-secret');assert.equal(body.get('identifier'),'user@example.com');assert.equal(body.has('password'),false);return reply({id:'sign_1',supported_first_factors:[{strategy:'email_code',email_address_id:'email_1'}]},'rotated-secret');}
  if(number===3){assert.equal(o.headers.Authorization,'Bearer rotated-secret');assert.equal(body.get('strategy'),'email_code');assert.equal(body.get('email_address_id'),'email_1');return reply({status:'needs_first_factor'});}
  if(u.pathname.endsWith('/attempt_first_factor')){assert.equal(body.get('code'),'123456');return reply({status:'complete',created_session_id:'sess_1'},'signed-in-secret',200,{sessions:[session]});}
  if(u.pathname.endsWith('/tokens/t3-relay'))return reply({jwt:'a.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+60})).toString('base64url')+'.s'});
  if(u.pathname.endsWith('/remove'))return reply({id:'sess_1',status:'removed'});
  return reply({sessions:[session]});
 };
 const login=await beginEmailLogin(' user@example.com ',fetcher as any);assert.equal(login.signInId,'sign_1');
 const a=await verifyEmailLogin(login,'123456',fetcher as any);assert.equal(a.userId,'user_1');assert.equal(a.clientToken,'signed-in-secret');
 let saves=0;const relay=await nativeRelayAccount(a,async()=>{saves++;},fetcher as any);assert.ok(relay.expiresAt>Date.now());assert.equal(saves,2);
 await revokeNativeAccount(a,fetcher as any);assert.equal(calls.at(-1),'/v1/client/sessions/sess_1/remove');
});

test('account expiry is distinct from a temporary transport failure or a wrong verification code',async()=>{
 const account={clientToken:'private',sessionId:'sess_1',userId:'user_1',identity:'user@example.com'};
 for(const fetcher of [async()=>reply({sessions:[]}),async()=>new Response(JSON.stringify({errors:[{code:'session_expired'}]}),{status:401})]){
  await assert.rejects(nativeRelayAccount({...account},async()=>{},fetcher as any),signInRequired);
 }
 await assert.rejects(nativeRelayAccount({...account},async()=>{},(async()=>{throw Error('offline');}) as any),error=>!signInRequired(error));
 await assert.rejects(nativeRelayAccount({...account},async()=>{},(async()=>new Response('{}',{status:503})) as any),error=>!signInRequired(error));
});

test('native sign-in rejects unsupported factors, wrong codes, stale accounts and hostile error details',async()=>{
 await assert.rejects(beginEmailLogin('not-email'),/email address/);
 let n=0;await assert.rejects(beginEmailLogin('user@example.com',(async()=>++n===1?reply({}):reply({id:'sign_1',supported_first_factors:[{strategy:'password'}]})) as any),/does not support/);
 const login={clientToken:'secret',signInId:'sign_1',email:'user@example.com',expiresAt:Date.now()+600000};
 await assert.rejects(verifyEmailLogin(login,'123456',(async()=>new Response(JSON.stringify({errors:[{code:'form_code_incorrect',message:'LEAK_SECRET'}]}),{status:422})) as any),e=>e instanceof Error&&/incorrect/.test(e.message)&&!e.message.includes('LEAK_SECRET'));
 await assert.rejects(verifyEmailLogin({...login,expiresAt:0},'123456'),/expired/);
 await assert.rejects(verifyEmailLogin(login,'abc'),/six-digit/);
 const account={clientToken:'secret',sessionId:'sess_1',userId:'user_1',identity:'user@example.com'};
 await assert.rejects(nativeRelayAccount(account,async()=>{},(async()=>reply({sessions:[{...session,user:{id:'another-user'}}]})) as any),/expired/);
});
