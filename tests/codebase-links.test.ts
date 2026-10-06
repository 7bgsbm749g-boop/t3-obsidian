import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectLink,projectPathRoutes} from '../codebase-links';
const main={environmentId:'a',projectId:'p',title:'Project',root:'/home/ubuntu/projects/code'};
const worktree={...main,root:'/home/ubuntu/worktrees/code',threadId:'thread'};
test('exact absolute paths, slashless Obsidian paths and file URLs resolve without rewriting',()=>{
 for(const value of ['/home/ubuntu/projects/code/docs/a.md','home/ubuntu/projects/code/docs/a.md','file:///home/ubuntu/projects/code/docs/a.md','sandbox:/home/ubuntu/projects/code/docs/a.md'])assert.deepEqual(projectPathRoutes(value,[main,worktree]).matches,[{scope:main,path:'docs/a.md'}]);
 assert.deepEqual(projectPathRoutes(worktree.root+'/a.ts',[main,worktree]).matches,[{scope:worktree,path:'a.ts'}]);
 assert.equal(projectPathRoutes(main.root+'-other/a.md',[main]).owned,false);
});
test('fragments, encoded names and line suffixes do not become file names',()=>{
 assert.deepEqual(projectLink(main.root+'/a%20b.ts:25:3#section'),{path:main.root+'/a b.ts',subpath:'#section',line:24,column:2});
 assert.equal(projectPathRoutes(main.root+'/a%23b.md',[main]).matches[0].path,'a#b.md');
 for(const value of ['https://example.com/file.md','file://another-host/home/a.md','mailto:test@example.com','//server/share/file.md','%zz'])assert.equal(projectLink(value),undefined);
});
test('owned invalid paths fail closed and longest root wins',()=>{
 for(const path of ['/../secret.md','/docs/../../secret.md','/docs//a.md','']){const result=projectPathRoutes(main.root+path,[main]);assert.equal(result.owned,true);assert.equal(result.matches.length,0);}
 const nested={...main,root:main.root+'/sub',projectId:'nested'};assert.deepEqual(projectPathRoutes(nested.root+'/a.md',[main,nested]).matches,[{scope:nested,path:'a.md'}]);
});
test('machine ambiguity remains explicit and Windows roots respect path boundaries',()=>{
 assert.equal(projectPathRoutes(main.root+'/a.md',[main,{...main,environmentId:'b'}]).matches.length,2);
 const windows={...main,root:'C:\\Projects\\Code'};assert.deepEqual(projectPathRoutes('file:///c:/projects/code/docs/a.ts:4',[windows]).matches,[{scope:windows,path:'docs/a.ts'}]);
 assert.equal(projectPathRoutes('C:\\Projects\\Code-other\\a.ts',[windows]).owned,false);
});
test('malformed escapes and file URI traversal retain project ownership without accepting a file',()=>{
 for(const value of [main.root+'/%zz.md','file://'+main.root+'/../escape.md']){const route=projectPathRoutes(value,[main]);assert.equal(route.owned,true);assert.equal(route.matches.length,0);}
});
test('malformed encoded paths cannot evade Windows or encoded root ownership',()=>{
 assert.equal(projectPathRoutes('C:/Work/bad%ZZ.md',[{...main,root:'c:/work'}]).owned,true);
 assert.equal(projectPathRoutes('/%77ork/bad%ZZ.md',[{...main,root:'/work'}]).owned,true);
});
test('nested roots on a different machine remain ambiguous instead of hiding a valid owner',()=>{
 const other={...main,environmentId:'b',root:main.root+'/nested'};const route=projectPathRoutes(other.root+'/a.md',[main,other]);assert.equal(route.matches.length,2);assert.equal(route.matches[0].path,'nested/a.md');assert.equal(route.matches[1].path,'a.md');
});
test('file URI query is separate while percent encoded question marks remain in the file name',()=>{
 assert.equal(projectPathRoutes('file://'+main.root+'/chart.png?cache=1',[main]).matches[0].path,'chart.png');
 assert.equal(projectPathRoutes('file://'+main.root+'/a%3Fb.md',[main]).matches[0].path,'a?b.md');
});
