import test from 'node:test';
import assert from 'node:assert/strict';
import {projectGroups} from '../src/projects/project-groups';
import {parseProjects} from '../src/app/bridge';
test('shared repositories sort first and preserve each checkout and unrelated same-name projects',()=>{
 const identity={canonicalKey:'checkout',origin:{canonicalKey:'github.com/example/repo'}};
 const [a,b]=['desktop','laptop'].map(connectionId=>({...parseProjects({projects:[{id:connectionId,title:'Repo',workspaceRoot:'/'+connectionId,repositoryIdentity:identity}]})[0],connectionId,connectionName:connectionId}));
 const unrelated={id:'third',title:'Repo',workspaceRoot:'/other',connectionId:'third',connectionName:'Other'};
 const groups=projectGroups([unrelated,b,a]);assert.equal(groups[0].label,'Shared projects');
 assert.deepEqual(new Set(groups[0].projects),new Set([a,b]));assert.deepEqual(groups[1].projects,[unrelated]);
 assert.equal(projectGroups([a,{...b,connectionId:a.connectionId}])[0].shared,false);
});
