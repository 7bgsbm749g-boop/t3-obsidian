import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {workspaceChildPath} from '../workspace-picker';
import {createDesktopFolder} from '../desktop';

test('workspace folder names stay within their parent on Linux and Windows',()=>{
  assert.equal(workspaceChildPath('/work','Café project'),'/work/Café project');
  assert.equal(workspaceChildPath('/','project'),'/project');
  assert.equal(workspaceChildPath('C:\\Work\\','project'),'C:\\Work\\project');
  for(const name of ['','..','../escape','child/leaf','child\\leaf','NUL','com1.txt','tail.','new\nfolder'])assert.throws(()=>workspaceChildPath('/work',name));
});

test('desktop folder creation makes an empty folder and preserves colliding files',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'t3-new-workspace-'));
  try{
    const folder=await createDesktopFolder(parent,'Café project');
    assert.deepEqual(await readdir(folder),[]);
    await assert.rejects(createDesktopFolder(parent,'Café project'),/already exists/);
    await writeFile(join(parent,'existing'),'keep');
    await assert.rejects(createDesktopFolder(parent,'existing'),/already exists/);
    assert.equal(await readFile(join(parent,'existing'),'utf8'),'keep');
    await assert.rejects(createDesktopFolder(parent,'../escape'),/valid folder name/);
  }finally{await rm(parent,{recursive:true,force:true});}
});
