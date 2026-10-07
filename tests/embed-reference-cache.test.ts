import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EmbedReferenceCache} from '../embed-reference-cache';
import {replyReferences} from '../reply-assets';

test('ordinary reads skip Markdown parsing and repeated image reads reuse syntax while changed text invalidates it',()=>{
 let calls=0;const cache=new EmbedReferenceCache(text=>{calls++;return replyReferences(text);});
 assert.deepEqual(cache.get('note','[file](src/main.ts)\nordinary prose'),[]);assert.equal(calls,0);
 const text='![plot](plot.png)\n![[image.svg]]\n![reference][img]\n\n[img]: /outside/photo.jpg';
 const first=cache.get('note',text);assert.deepEqual(first.map(r=>r.source),['plot.png','image.svg','/outside/photo.jpg']);
 for(let i=0;i<100;i++)assert.equal(cache.get('note',text),first);assert.equal(calls,1);
 assert.equal(cache.get('note',text.replace('plot.png','new.png'))[0].source,'new.png');assert.equal(calls,2);
});
test('image reference cache evicts by retained text size and count and does not retain oversized notes',()=>{
 let calls=0;const cache=new EmbedReferenceCache(text=>{calls++;return replyReferences(text);},150,2);
 const text='![x](x.png)';cache.get('a',text);cache.get('b',text);cache.get('c',text);cache.get('a',text);assert.equal(calls,4);
 const huge=text+'x'.repeat(151);cache.get('huge',huge);cache.get('huge',huge);assert.equal(calls,6);
 cache.clear();cache.get('a',text);assert.equal(calls,7);
});

test('ordinary large notes consume no image-cache slots or character budget and cannot evict warm image syntax',()=>{
 let calls=0;const cache=new EmbedReferenceCache(text=>{calls++;return replyReferences(text);},150,2);
 const image='![x](x.png)',warm=cache.get('image',image);
 for(let n=0;n<100;n++)assert.deepEqual(cache.get('ordinary-'+n,'ordinary '.repeat(10000)),[]);
 assert.equal(cache.status().entries,1);assert.ok(cache.status().characters<150);assert.equal(cache.status().plainReads,100);
 assert.equal(cache.get('image',image),warm);assert.equal(calls,1);assert.equal(cache.status().sourceParses,1);
 cache.get('image','ordinary replacement');assert.equal(cache.status().entries,0);assert.equal(cache.status().characters,0);
 cache.get('image',image);assert.equal(calls,2);
});

test('image-like syntax inside code retains a bounded negative parse result until the exact text changes',()=>{
 let calls=0;const cache=new EmbedReferenceCache(text=>{calls++;return replyReferences(text);});
 const code='```md\n![x](x.png)\n```',negative=cache.get('code',code);assert.deepEqual(negative,[]);
 for(let n=0;n<100;n++)assert.equal(cache.get('code',code),negative);
 assert.equal(calls,1);assert.equal(cache.get('code','![x](x.png)')[0].source,'x.png');assert.equal(calls,2);
 cache.clear();assert.equal(cache.status().entries,0);assert.equal(cache.status().characters,0);
});
