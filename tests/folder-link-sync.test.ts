import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyFolderLinkChanges,changedFolderLinks,loadFolderLinkChanges,mergeFolderLinkChanges,mergeLegacyFolderLinks,type FolderLinkChange} from '../folder-link-sync';
import type {FolderLink} from '../folder-link';
const link=(folderPath:string,projectId='project'):FolderLink=>({id:folderPath,folderPath,projectId,projectTitle:projectId,connectionId:'c',workspaceRoot:'/repo',self:false});
test('link, relink and unlink records survive stale whole-file Sync snapshots',()=>{
  const original=link('Notes'),created=changedFolderLinks([], [original],[],()=> 'create',1000);
  assert.deepEqual(applyFolderLinkChanges([],created),[original]);
  const replacement=link('Notes','other'),relinked=changedFolderLinks([original],[replacement],created,()=> 'relink',900);
  assert.ok(relinked[0].at>created[0].at,'clock rollback must still advance the mutation');
  const current=mergeFolderLinkChanges(created,relinked);assert.deepEqual(applyFolderLinkChanges([original],current),[replacement]);
  const removed=changedFolderLinks([replacement],[],current,()=> 'unlink',3000);
  assert.equal(removed[0].link,null);assert.deepEqual(applyFolderLinkChanges([original],mergeFolderLinkChanges(created,relinked,removed)),[]);
  assert.deepEqual(changedFolderLinks([original],[original],created,()=>{throw Error('Must not create duplicate mutations');}),[]);
});
test('different folders merge and same-time conflicts converge independently of delivery order',()=>{
  const a:FolderLinkChange={folderPath:'Notes',id:'a',at:'2026-10-02T00:00:00.000Z',link:link('Notes')};
  const b={...a,id:'b',link:null},nested={...a,folderPath:'Notes/Inner',link:link('Notes/Inner')};
  assert.deepEqual(mergeFolderLinkChanges([a,nested],[b]),mergeFolderLinkChanges([b],[nested,a]));
  assert.deepEqual(applyFolderLinkChanges([],mergeFolderLinkChanges([a,nested],[b])),[nested.link]);
  assert.deepEqual(loadFolderLinkChanges([a,b,nested,{...a,at:'bad'},{...a,folderPath:'../bad'},{...a,link:link('different')}]),mergeFolderLinkChanges([a,b,nested]));
});
test('legacy folder links adopt remote edits only where the local snapshot is unchanged',()=>{
  const a=link('A'),b=link('B'),remote=link('Remote'),changed=link('A','new');
  assert.deepEqual(mergeLegacyFolderLinks([a,b],[a,remote],[changed,b]),[changed,remote]);
  assert.deepEqual(mergeLegacyFolderLinks([a,b],[a,b,remote],[b]),[b,remote]);
});
