import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_REPLY_FOLDERS,loadReplyFolders,replyFolder,resolveReplyFolders,validateReplyFolders} from '../reply-locations';
import {normalizeFolderLink,type FolderLink} from '../folder-link';
import {changedFolderLinks,applyFolderLinkChanges,loadFolderLinkChanges} from '../folder-link-sync';
const link=(folderPath:string,replyFolders?:FolderLink['replyFolders']):FolderLink=>({id:folderPath,folderPath,projectId:'project',projectTitle:'Project',connectionId:'local',workspaceRoot:'/workspace',self:false,replyFolders});
test('unlinked notes use general folders; linked notes use their nearest project subfolders',()=>{
  const general={images:'Media/T3',files:'Documents/T3'},links=[link('/'),link('Projects/App',{images:'Pictures',files:'Files'}),link('Projects/App/Nested')];
  for(const path of ['root.md','Unlinked/note.md','Projects/Application/note.md'])assert.deepEqual(resolveReplyFolders(general,links,path),general);
  assert.deepEqual(resolveReplyFolders(general,links,'Projects/App/Jobs/note.md'),{images:'Projects/App/Pictures',files:'Projects/App/Files'});
  assert.deepEqual(resolveReplyFolders(general,links,'Projects/App/Nested/note.md'),{images:'Projects/App/Nested/T3 Code Attachments',files:'Projects/App/Nested/T3 Code Attachments'});
  assert.deepEqual(loadReplyFolders(undefined),DEFAULT_REPLY_FOLDERS);
  assert.deepEqual(resolveReplyFolders(general,links,'Brand new/answer.md',link('Brand new',{images:'Images',files:'Files'})),{images:'Brand new/Images',files:'Brand new/Files'});
});
test('destinations reject traversal, absolute paths, hidden settings and malformed values',()=>{
  for(const path of ['', '/', '/tmp/files', '../Other','Foo/../Other','Foo/.obsidian','C:/Files','Foo//Bar','Foo/./Bar','Foo/Bar\nOther','Foo /Bar'])assert.throws(()=>replyFolder(path),/folder/i);
  assert.equal(replyFolder(' Pictures\\T3/ '),'Pictures/T3');
  assert.deepEqual(loadReplyFolders({images:'../bad',files:'Files'}),{images:DEFAULT_REPLY_FOLDERS.images,files:'Files'});
  assert.throws(()=>validateReplyFolders({images:'Images',files:'../bad'}));
});
test('per-folder locations normalize, survive mutation replication and produce a new explicit edit',()=>{
  const old=normalizeFolderLink(link('Project',{images:'Images',files:'Files'}));
  const next=normalizeFolderLink({...old,replyFolders:{images:'Images',files:'Documents/T3'}});
  const edits=changedFolderLinks([old],[next],[],()=> 'edit',1000);
  assert.equal(edits.length,1);
  assert.deepEqual(applyFolderLinkChanges([old],loadFolderLinkChanges(edits)),[next]);
});
