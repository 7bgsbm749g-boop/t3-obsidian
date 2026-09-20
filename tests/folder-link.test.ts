import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFolderLinks,normalizeFolderLink,normalizeFolderPath,upsertFolderLink,folderLinkForPath,sameWorkspacePath,type FolderLink} from '../folder-link';

const link:FolderLink={id:'one',folderPath:'Projects/App',connectionId:'laptop',projectId:'project',projectTitle:'App',workspaceRoot:'C:/vault/Projects/App',self:false};

test('folder links normalize paths and reject incomplete or escaping data',()=>{
  assert.equal(normalizeFolderPath(' /Projects\\App/ '),'Projects/App');
  for(const path of ['','../Projects','Projects/../App'])assert.throws(()=>normalizeFolderPath(path));
  assert.equal(normalizeFolderLink(link).folderPath,'Projects/App');
  assert.throws(()=>normalizeFolderLink({...link,projectId:''}));
});

test('one saved destination replaces the previous link for a folder',()=>{
  const next={...link,id:'two',projectId:'other',projectTitle:'Other'};
  assert.deepEqual(upsertFolderLink([link],next),[next]);
});

test('legacy folder triggers migrate to inert links without trigger behavior',()=>{
  const data={folderTriggers:[{id:'old',folderPath:'Projects/App',connectionId:'laptop',projectId:'project',projectTitle:'App',workspaceRoot:'C:/vault/Projects/App',tag:'ready',enabled:true}],folderTriggerReceipts:[{key:'ignored'}]};
  assert.deepEqual(loadFolderLinks(data),[{id:'old',folderPath:'Projects/App',connectionId:'laptop',projectId:'project',projectTitle:'App',workspaceRoot:'C:/vault/Projects/App',self:false}]);
});

test('vault root links persist and the nearest folder owns a note on a path boundary',()=>{
  const root={...link,id:'root',folderPath:'/'};
  const nested={...link,id:'nested',folderPath:'Projects/App/Inner'};
  const links=loadFolderLinks({folderLinks:[root,link,nested]});
  assert.equal(links.length,3);
  assert.equal(folderLinkForPath(links,'root.md')?.id,'root');
  assert.equal(folderLinkForPath(links,'Projects/Application/note.md')?.id,'root');
  assert.equal(folderLinkForPath(links,'Projects/App/note.md')?.id,'one');
  assert.equal(folderLinkForPath(links,'Projects/App/Inner/note.md')?.id,'nested');
  assert.equal(folderLinkForPath([link],'Unlinked/note.md'),undefined);
  assert.equal(sameWorkspacePath('/vault/Notes','/vault/notes'),false);
  assert.equal(sameWorkspacePath('C:\\Vault\\Notes','c:/vault/notes/'),true);
});
