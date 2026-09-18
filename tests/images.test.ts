import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectImages,findImageEmbeds,MAX_IMAGE_BYTES} from '../images';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64');
test('finds ordered wiki, Markdown and reference images while ignoring code, escapes, notes and frontmatter',()=>{
 const md='---\na: "![[metadata.png]]"\n---\n![[photo.png|300]]\n![alt](folder/a%20b.png "title")\n![reference][pic]\n\n[pic]: other.png\n\n`![[inline.png]]`\n\n```md\n![code](bad.png)\n```\n\\![[escaped.png]]\n![[Other note]]\n';
 const images=findImageEmbeds(md);
 assert.deepEqual(images.map(i=>i.link),['photo.png','folder/a%20b.png','other.png']);
 assert.deepEqual(images.map(i=>i.line),[4,5,6]);
});
test('deduplicates image bytes and puts native references in each original position',async()=>{
 const result=await collectImages('![[a.png]]\n\n![other](b.png)\n![[a.png|400]]',async()=>({bytes:png,name:'a.png'}));
 assert.equal(result.attachments.length,1);assert.equal(result.attachments[0].dataUrl,`data:image/png;base64,${png.toString('base64')}`);
 assert.equal(result.context.records.length,1);
 assert.equal(result.markdown.split('t3-context://').length-1,3);
 assert.equal(result.markdown.split('\n').length,4);
 assert.equal(result.context.records[0].attachmentId,result.attachments[0].id);
});
test('missing, unsupported, oversized and too-many images reject without partial success',async()=>{
 await assert.rejects(collectImages('![[missing.png]]',async()=>{throw new Error('not found');}),/line 1.*not found/);
 await assert.rejects(collectImages('![[a.svg]]',async()=>({bytes:Buffer.from('<svg/>'),name:'a.svg'})),/Unsupported/);
 await assert.rejects(collectImages('![[a.png]]',async()=>({bytes:Buffer.alloc(MAX_IMAGE_BYTES+1),name:'a.png'})),/10 MiB/);
 const md=Array.from({length:9},(_,i)=>`![[${i}.png]]`).join('\n');
 await assert.rejects(collectImages(md,async e=>({bytes:Buffer.concat([png,Buffer.from(e.link)]),name:e.link})),/at most 8/);
});

test('text-only notes are sent verbatim without vault, path or title wrappers',async()=>{
 const md='---\ntitle: café\n---\n# Hello\n```sh\n$(printf unsafe); `whoami`\n```\n尾\n';
 const result=await collectImages(md,async()=>{throw new Error('Unexpected image read');});
 assert.equal(result.markdown,md);assert.deepEqual(result.attachments,[]);
});
