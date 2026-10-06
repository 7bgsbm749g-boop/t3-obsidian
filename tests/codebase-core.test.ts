import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CodebaseDocument,changeCodebaseProjectLinks,codebaseRootLabels,scopeKey,linkedCodebases,contextualCandidates,relativeCodebasePath,virtualPath,type CodebaseIO,type CodebaseScope} from '../codebase-core';
const scope:CodebaseScope={environmentId:'machine',projectId:'project',root:'/external/project',title:'Project'};
const link={id:'link',connectionId:'local',folderPath:'Linked',projectId:'project',environmentId:'machine',workspaceRoot:'/external/project',projectTitle:'Project',self:false};
function fixture(){let remote='original',writes=0,draft:string|undefined;const io:CodebaseIO={list:async()=>({entries:[],truncated:false}),search:async()=>[],resource:async()=>({url:'https://example.invalid',expiresAt:0}),read:async()=>remote,write:async(_s,_p,text)=>{writes++;remote=text;}};return {io,document:new CodebaseDocument(scope,'file.md',io,value=>draft=value),get remote(){return remote;},set remote(value:string){remote=value;},get writes(){return writes;},get draft(){return draft;}};}
test('project registry excludes self links and deduplicates linked folders',()=>{assert.deepEqual(linkedCodebases([link,{...link,id:'second',folderPath:'Other'},{...link,projectId:'vault',self:true}]),[scope]);});
test('a second ordinary link cannot expose the vault project for browsing or deletion',()=>{assert.deepEqual(linkedCodebases([link,{...link,id:'self',self:true},{...link,id:'remote',environmentId:'other-machine'}]),[{...scope,environmentId:'other-machine'}]);});
test('bare names prefer the linked project, with duplicate paths left ambiguous',()=>{const a={scope,path:'a/report.md'},b={scope:{...scope,projectId:'other'},path:'report.md'};assert.deepEqual(contextualCandidates([a,b],'report.md','Linked/Note.md',[link]),[a]);assert.equal(contextualCandidates([a,{...a,path:'b/report.md'}],'report','Linked/Note.md',[link]).length,2);});
test('virtual paths reject traversal, absolute paths and empty segments',()=>{for(const path of ['../secret','/root/file','a//b','a/./b','C:/file','a\\b','a\nfile'])assert.throws(()=>relativeCodebasePath(path));assert.match(virtualPath(scope,'docs/report.md'),/^__t3_codebase__\/machine\/project\/main\/%2Fexternal%2Fproject\/docs\/report.md$/);});
test('verified save clears the local draft and does not rewrite unchanged files',async()=>{const f=fixture();await f.document.read();await f.document.save('edited');assert.equal(f.remote,'edited');assert.equal(f.draft,undefined);await f.document.save('edited');assert.equal(f.writes,1);});
test('external edits prevent overwrite and retain the draft',async()=>{const f=fixture();await f.document.read();f.remote='agent edit';await assert.rejects(f.document.save('my edit'),/changed/);assert.equal(f.remote,'agent edit');assert.equal(f.writes,0);assert.equal(f.draft,'my edit');});
test('unconfirmed saves are never retried automatically',async()=>{const f=fixture();await f.document.read();f.io.write=async()=>{throw Error('connection closed');};await assert.rejects(f.document.save('my edit'),/connection closed/);await assert.rejects(f.document.save('my edit'),/not confirmed/);assert.equal(f.draft,'my edit');});
test('queued edits keep the newer draft until its own save is confirmed',async()=>{const f=fixture();await f.document.read();await Promise.all([f.document.save('first'),f.document.save('second')]);assert.equal(f.remote,'second');assert.equal(f.draft,undefined);});
test('moving a project root gives native leaves separate identities for late autosave safety',()=>{assert.notEqual(virtualPath(scope,'file.md'),virtualPath({...scope,root:'/other/project'},'file.md'));});
test('a cached vault read reports the saved base while an editor draft is unsaved',async()=>{const f=fixture();await f.document.read();f.document.draft='unsaved text';assert.equal(await f.document.read(),'original');});
test('unchanged navigation performs no IO and preserves an uncertain recovery draft',async()=>{
 const f=fixture();await f.document.read();let reads=0;f.io.read=async()=>{reads++;return 'external update';};
 await f.document.save('original');assert.equal(reads,0);assert.equal(f.writes,0);assert.equal(f.draft,undefined);
 f.document.uncertain=true;f.document.draft='real unsaved edit';await f.document.save('original');
 assert.equal(f.document.uncertain,true);assert.equal(f.document.draft,'real unsaved edit');assert.equal(reads,0);assert.equal(f.writes,0);
});
test('unchanged old buffer cannot replace a queued real edit',async()=>{
 const f=fixture();await f.document.read();await Promise.all([f.document.save('real edit'),f.document.save('original')]);
 assert.equal(f.remote,'real edit');assert.equal(f.writes,1);assert.equal(f.draft,undefined);
});
test('duplicate project titles identify workspace parents without changing identities',()=>{
 const a={...scope,title:'Send to T3 Code',root:'/home/ubuntu/projects/send-to-t3-code'},b={...a,projectId:'old',root:'/home/ubuntu/vault/.obsidian/plugins/send-to-t3-code'},solo={...scope,projectId:'solo',title:'Other'};
 const labels=codebaseRootLabels([a,b,solo]);assert.equal(labels.get(scopeKey(a)),'Send to T3 Code (projects)');assert.equal(labels.get(scopeKey(b)),'Send to T3 Code (plugins)');assert.equal(labels.get(scopeKey(solo)),'Other');assert.equal(a.title,b.title);
 const siblings=[{...a,root:'/work/alpha'},{...b,root:'/work/beta'}],siblingLabels=codebaseRootLabels(siblings);assert.equal(siblingLabels.get(scopeKey(a)),'Send to T3 Code (alpha)');assert.equal(siblingLabels.get(scopeKey(b)),'Send to T3 Code (beta)');
});

test('project changes update only exact machine/project links and preserve folders and other machines',()=>{
 const links=[link,{...link,id:'other-folder',folderPath:'Second'}, {...link,id:'remote',environmentId:'other-machine'}, {...link,id:'other-project',projectId:'other-project'}];
 const renamed=changeCodebaseProjectLinks(links,scope,{title:'Renamed'},l=>l.environmentId);
 assert.deepEqual(renamed.map(l=>l.projectTitle),['Renamed','Renamed','Project','Project']);assert.deepEqual(renamed.map(l=>l.folderPath),links.map(l=>l.folderPath));assert.equal(links[0].projectTitle,'Project');
 assert.deepEqual(changeCodebaseProjectLinks(links,scope,{deleted:true},l=>l.environmentId),links.slice(2));
});
