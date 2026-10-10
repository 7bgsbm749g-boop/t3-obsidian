import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionRecovery,type ConnectionReloadState} from '../connection-recovery';
import {T3ConnectionTimeoutError,T3RequestTimeoutError} from '../t3-rpc';
const timeout=(id:string)=>new T3ConnectionTimeoutError(id,'projects.readFile',8000,1,8000);
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(){
  let now=0,state:ConnectionReloadState={},reloads=0,blocked=false,hold:Promise<void>|undefined;const errors:unknown[]=[];
  const io={load:()=>state,save:(value:ConnectionReloadState)=>{state=value;},now:()=>now,failure:(e:unknown)=>errors.push(e),reload:async(commit:()=>boolean)=>{
    if(blocked)throw Error('Unsaved edits');if(hold)await hold;
    if(!commit())return false;assert.equal(state.awaitingRecovery,'host');reloads++;return true;
  }};
  return {io,create:()=>new ConnectionRecovery(io),advance:(ms:number)=>{now+=ms;},state:()=>state,reloads:()=>reloads,errors,block:(value:boolean)=>{blocked=value;},hold:(value:Promise<void>)=>{hold=value;}};
}
test('only failures on two distinct silent connections trigger a persisted automatic reload',async()=>{
  const h=fixture(),r=h.create();r.failed('host',new T3RequestTimeoutError('read',15000));r.failed('host',timeout('a'));r.failed('host',timeout('a'));
  h.advance(1000);r.tick();await flush();assert.equal(h.reloads(),0);
  r.failed('host',timeout('b'));h.advance(1000);r.tick();r.tick();await flush();assert.equal(h.reloads(),1);assert.equal(h.state().awaitingRecovery,'host');
});
test('unsaved edits defer reload, and recovery cancels a reload while its guard is still running',async()=>{
  const h=fixture(),r=h.create();h.block(true);r.failed('host',timeout('a'));r.failed('host',timeout('b'));h.advance(1000);r.tick();await flush();
  assert.equal(h.reloads(),0);assert.equal(h.state().awaitingRecovery,undefined);assert.equal(r.status().pending,true);
  h.block(false);let release!:()=>void;h.hold(new Promise<void>(yes=>release=yes));h.advance(3000);r.tick();await flush();r.recovered('host');release();await flush();
  assert.equal(h.reloads(),0);assert.equal(r.status().pending,false);
});
test('an offline client cannot reload repeatedly across app instances and a cooldown remains after recovery',async()=>{
  const h=fixture(),first=h.create();first.failed('host',timeout('a'));first.failed('host',timeout('b'));h.advance(1000);first.tick();await flush();first.dispose();
  const second=h.create();second.failed('host',timeout('c'));second.failed('host',timeout('d'));h.advance(400000);second.tick();await flush();assert.equal(h.reloads(),1);
  second.recovered('host');second.failed('host',timeout('e'));second.failed('host',timeout('f'));h.advance(1000);second.tick();await flush();assert.equal(h.reloads(),2);
  second.recovered('host');second.failed('host',timeout('g'));second.failed('host',timeout('h'));h.advance(1000);second.tick();await flush();assert.equal(h.reloads(),2);
});
test('timeouts far apart or on different machines do not confirm one outage',async()=>{
  const h=fixture(),r=h.create();r.failed('host',timeout('a'));r.failed('other',timeout('b'));h.advance(61000);r.failed('host',timeout('c'));h.advance(1000);r.tick();await flush();assert.equal(h.reloads(),0);
});
