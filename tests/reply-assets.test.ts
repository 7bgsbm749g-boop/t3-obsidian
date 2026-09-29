import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replyReferences,rewriteReplyReferences} from '../reply-assets';

test('reply file references keep their order and skip code and external links',async()=>{
  const answer='Before ![plot](/tmp/plot.png) and [report](/tmp/report.pdf).\n\n![[Pasted image.png]]\n\n```md\n![example](/tmp/no.png)\n```\n\n[site](https://example.com)';
  const refs=replyReferences(answer);
  assert.deepEqual(refs.map(ref=>[ref.source,ref.image,ref.label]),[['/tmp/plot.png',true,'plot'],['/tmp/report.pdf',false,'report'],['Pasted image.png',true,''] ,['https://example.com',false,'site']]);
  const rewritten=await rewriteReplyReferences(answer,async ref=>ref.source.startsWith('http')?undefined:`${ref.image?'!':''}[[vault/${ref.source.split('/').at(-1)}]]`);
  assert.match(rewritten,/Before !\[\[vault\/plot\.png\]\] and \[\[vault\/report\.pdf\]\]/);
  assert.match(rewritten,/!\[\[vault\/Pasted image\.png\]\]/);
  assert.match(rewritten,/```md\n!\[example\]\(\/tmp\/no\.png\)\n```/);
  assert.match(rewritten,/\[site\]\(https:\/\/example\.com\)/);
});
