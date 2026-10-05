import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readDesktopReplyFile} from '../reply-import-desktop';
test('desktop reader preserves binary and empty files, resolves project paths and enforces bounds',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'t3-reply-'));
  try{
    const bytes=Uint8Array.from([80,75,3,4,0,255,128,0]);
    await writeFile(join(dir,'report.zip'),bytes);await writeFile(join(dir,'empty.txt'),'');await mkdir(join(dir,'folder'));
    assert.deepEqual(await readDesktopReplyFile('report.zip',dir),bytes);
    assert.deepEqual(await readDesktopReplyFile(join(dir,'report.zip'),'/different'),bytes);
    assert.equal((await readDesktopReplyFile('empty.txt',dir)).length,0);
    await assert.rejects(readDesktopReplyFile('report.zip',dir,4),/exceeds/);
    await assert.rejects(readDesktopReplyFile('folder',dir),/regular file/);
    await assert.rejects(readDesktopReplyFile('missing.txt',dir),/ENOENT/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
