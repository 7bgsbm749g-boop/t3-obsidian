import {test} from 'node:test';
import assert from 'node:assert/strict';
import {markdownCodeRanges,escapeReplyHtml,markdownCodeCacheStatus} from '../reply-html';
import {randomUUID} from 'node:crypto';

test('cached code ranges remain independent of caller mutation and changed source',()=>{
  const source='Prose <tag>\n\n```md\n<inside>\n```\n';
  const expected=markdownCodeRanges(source);
  const ranges=markdownCodeRanges(source);ranges[0][0]=0;ranges.push([0,source.length]);
  assert.deepEqual(markdownCodeRanges(source),expected);
  assert.equal(escapeReplyHtml(source),'Prose \\<tag>\n\n```md\n<inside>\n```\n');
  assert.deepEqual(markdownCodeRanges(source),expected,'Escaping cannot mutate cached ranges');
  assert.deepEqual(markdownCodeRanges('No code'),[]);
});

test('exact repeated source avoids parsing, while changed fenced source is parsed afresh',()=>{
 const prefix=`Prelude ${randomUUID()}\n\n`,source=prefix+'```md\n<!-- t3-inline:start:example -->\n```\n',before=markdownCodeCacheStatus();
 const ranges=markdownCodeRanges(source);assert.equal(ranges.length,1);
 for(let i=0;i<20;i++)assert.deepEqual(markdownCodeRanges(source),ranges);
 const warm=markdownCodeCacheStatus();assert.equal(warm.sourceParses-before.sourceParses,1);assert.equal(warm.hits-before.hits,20);
 assert.deepEqual(markdownCodeRanges(prefix+'<!-- t3-inline:start:example -->\n'),[]);assert.equal(markdownCodeCacheStatus().sourceParses,warm.sourceParses+1);
});

test('code-range source and entry bounds evict old documents without retaining syntax trees',()=>{
 const prefix=randomUUID();
 for(let i=0;i<40;i++)markdownCodeRanges(`${prefix}-${i}\n\n\`code\``);
 assert.ok(markdownCodeCacheStatus().entries<=32);
 const sources=Array.from({length:5},(_,i)=>'```text\n'+prefix+'-'+i+'\n'+'x'.repeat(2_000_000)+'\n```\n');
 for(const source of sources){const ranges=markdownCodeRanges(source);assert.equal(ranges.length,1);const status=markdownCodeCacheStatus();assert.ok(status.characters<=status.maxCharacters);assert.ok(status.entries<=status.maxEntries);}
 const before=markdownCodeCacheStatus().sourceParses;markdownCodeRanges(sources[0]);assert.equal(markdownCodeCacheStatus().sourceParses,before+1,'an evicted document must get a fresh parse');
});
