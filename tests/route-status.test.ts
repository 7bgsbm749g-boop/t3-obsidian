import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RouteStatus} from '../src/connection/route-status';

test('active status follows live transports, including several routes and closed sockets',()=>{
 const state=new RouteStatus(),a={closed:false,error:undefined as Error|undefined},b={closed:false};
 assert.equal(state.active('a'),false);state.track('a',a);state.track('b',b);
 assert.equal(state.active('a'),true);assert.equal(state.active('b'),true);
 a.error=Error('The machine stopped responding');a.closed=true;
 assert.equal(state.active('a'),false);assert.equal(state.failure('a'),'The machine stopped responding');assert.equal(state.active('b'),true);
 state.track('a',{closed:false});assert.equal(state.failure('a'),undefined);assert.equal(state.active('a'),true);
 state.retain(['b']);assert.equal(state.active('a'),false);assert.equal(state.active('b'),true);state.clear();assert.equal(state.active('b'),false);
});
test('concurrent requests clear their connecting status on success and failure without becoming a live connection',async()=>{
 const state=new RouteStatus();let done!:()=>void;
 const work=state.request('a',()=>new Promise<void>(resolve=>{done=resolve;}));
 await assert.rejects(state.request('a',async()=>{throw Error('offline');}),/offline/);
 assert.equal(state.pending('a'),true);assert.equal(state.active('a'),false);
 done();await work;assert.equal(state.pending('a'),false);assert.equal(state.active('a'),false);
});
