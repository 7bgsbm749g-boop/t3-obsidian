import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseProjects,runBridge} from '../bridge';
test('discovery validates projects and allows an empty environment',()=>{
 assert.deepEqual(parseProjects({projects:[]}),[]);
 assert.throws(()=>parseProjects({projects:[{id:'x'}]}));
 assert.throws(()=>parseProjects({projects:[{id:'x',title:'a',workspaceRoot:'/'},{id:'x',title:'b',workspaceRoot:'/'}]}));
});
