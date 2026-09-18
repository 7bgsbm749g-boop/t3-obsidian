import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFolderLinks,normalizeFolderLink,normalizeFolderPath,upsertFolderLink,type FolderLink} from '../folder-link';

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
