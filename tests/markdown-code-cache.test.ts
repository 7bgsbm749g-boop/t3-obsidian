import {test} from 'node:test';
import assert from 'node:assert/strict';
import {markdownCodeRanges,escapeReplyHtml} from '../reply-html';

test('cached code ranges remain independent of caller mutation and changed source',()=>{
  const source='Prose <tag>\n\n```md\n<inside>\n```\n';
  const expected=markdownCodeRanges(source);
  const ranges=markdownCodeRanges(source);ranges[0][0]=0;ranges.push([0,source.length]);
  assert.deepEqual(markdownCodeRanges(source),expected);
  assert.equal(escapeReplyHtml(source),'Prose \\<tag>\n\n```md\n<inside>\n```\n');
  assert.deepEqual(markdownCodeRanges(source),expected,'Escaping cannot mutate cached ranges');
  assert.deepEqual(markdownCodeRanges('No code'),[]);
});
