import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {App} from 'obsidian';
import {workspaceDocument,watchWorkspaceDocuments} from '../src/ui/workspace-documents';
import {WikiGesture} from '../src/projects/wiki-gesture';

function workspace(){
  const main={} as Document,popout={} as Document;
  const callbacks=new Map<string,(workspace:unknown,window:{document:Document})=>void>();
  const app={workspace:{containerEl:{ownerDocument:main},iterateAllLeaves:(visit:(leaf:unknown)=>void)=>{visit({view:{containerEl:{ownerDocument:main}}});visit({view:{containerEl:{ownerDocument:popout}}});},on:(name:string,callback:(...args:unknown[])=>void)=>{callbacks.set(name,callback as never);return name;},offref:(name:string)=>{callbacks.delete(name);}}} as unknown as App;
  return {app,main,popout,callbacks};
}

test('workspace controls cover existing and new windows and close each installation once',()=>{
  const h=workspace(),installed:Document[]=[],closed:Document[]=[];
  assert.equal(workspaceDocument(h.app),h.main);
  const stop=watchWorkspaceDocuments(h.app,root=>{installed.push(root);return ()=>{closed.push(root);};});
  assert.deepEqual(installed,[h.main,h.popout]);
  h.callbacks.get('window-open')!(null,{document:h.popout});assert.equal(installed.length,2);
  const later={} as Document;h.callbacks.get('window-open')!(null,{document:later});
  h.callbacks.get('window-close')!(null,{document:h.popout});assert.deepEqual(closed,[h.popout]);
  stop();stop();assert.deepEqual(closed,[h.popout,h.main,later]);assert.equal(h.callbacks.size,0);
});

test('a failed window installation releases the earlier owned resources',()=>{
  const h=workspace(),closed:Document[]=[];
  assert.throws(()=>watchWorkspaceDocuments(h.app,root=>{if(root===h.popout)throw Error('Fixture refused');return ()=>{closed.push(root);};}),/Fixture refused/);
  assert.deepEqual(closed,[h.main]);assert.equal(h.callbacks.size,0);
});

test('wiki gestures belong to the current native input event and source note',async()=>{
  const listeners=new Map<string,EventListener>(),root={addEventListener:(name:string,listener:EventListener)=>listeners.set(name,listener),removeEventListener:(name:string)=>listeners.delete(name)} as unknown as Document;
  const wiki={ownerDocument:root,closest:()=>wiki} as unknown as Element,other={closest:()=>null};
  const context=new WikiGesture(),stop=context.watch(root,()=> 'Notes/Source.md');
  listeners.get('click')!({target:wiki} as unknown as Event);
  assert.equal(context.owns('Notes/Source.md'),true);assert.equal(context.owns('Other.md'),false);
  await Promise.resolve();assert.equal(context.owns('Notes/Source.md'),false);
  listeners.get('keydown')!({type:'keydown',target:wiki,key:'a'} as unknown as Event);assert.equal(context.owns('Notes/Source.md'),false);
  listeners.get('keydown')!({type:'keydown',target:wiki,key:'Enter'} as unknown as Event);assert.equal(context.owns('Notes/Source.md'),true);
  listeners.get('click')!({target:other} as unknown as Event);assert.equal(context.owns('Notes/Source.md'),false);
  listeners.get('click')!({target:wiki} as unknown as Event);stop();assert.equal(context.owns('Notes/Source.md'),false);assert.equal(listeners.size,0);
});
