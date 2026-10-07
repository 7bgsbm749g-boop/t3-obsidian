import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {markdownCodeRanges,markdownCodeCacheStatus} from '../reply-html';

const reference=unified().use(remarkParse);
function originalRanges(source:string){
 const ranges:Array<[number,number]>=[];
 function visit(node:any){if(node.type==='code'||node.type==='inlineCode')ranges.push([node.position.start.offset,node.position.end.offset]);else if(node.children)for(const child of node.children)visit(child);}
 visit(reference.parse(source.replace(/</g,' ')));return ranges;
}

test('code-only tokens preserve original CommonMark offsets across linked chunks, escaped markers and whitespace',()=>{
 const marker='<!-- t3-inline:start:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee -->';
 const pieces=[
  'Plain **prose**, [link](https://example.test) and &amp;.\n',
  '`inline\n'+marker+'`\n','`` x ` y ``\n','\\`not a code span\n',
  '```md\n'+marker+'\n```\n','~~~md\r\n'+marker+'\r\n~~~\r\n',
  '    '+marker+'\n\n','> ```md\n> '+marker+'\n> ```\n',
  '> start `span\n> '+marker+'\n> end`\n',
  '> start `span\n'+marker+'\nend`\n',
  '- text\n\n    ```md\n    '+marker+'\n    ```\n',
  '[`label`](<https://example.test/`path`>)\n',
  '[reference]\n\n[reference]: /url "`title`"\n',
  '<div>\n~~~\n'+marker+'\n~~~\n</div>\n',
  '😀 café\t`😄`\r\n','\u0000\n`a\u0000b`\n','\ud800 `\udfff`\r\n',
  '# Heading with `code`\n\n---\n\n','- `first\n  second`\n',
 ];
 for(const first of pieces)for(const second of pieces){const source=first+'\n'+second;assert.deepEqual(markdownCodeRanges(source),originalRanges(source),JSON.stringify(source));}
 // Mix constructs and cut streamed prefixes, so an unfinished span/fence is
 // checked against the independent full AST parser as well as complete notes.
 let seed=72831;
 for(let i=0;i<400;i++){
  const pick=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return pieces[seed%pieces.length];};
  const full=pick()+pick()+pick(),source=i%2?full:full.slice(0,i%full.length);
  assert.deepEqual(markdownCodeRanges(source),originalRanges(source),JSON.stringify(source));
 }
});

test('prose chunks avoid inline allocation while block code and caller-owned ranges remain exact',()=>{
 const text=randomUUID()+'\n\nPlain **prose** and [link](https://example.test).\n\n> More words\n\n~~~\nblock\n~~~\n';
 const before=markdownCodeCacheStatus(),expected=originalRanges(text),first=markdownCodeRanges(text),after=markdownCodeCacheStatus();
 assert.deepEqual(first,expected);assert.ok(after.skippedTextGroups-before.skippedTextGroups>=2);
 first[0][0]=-1;assert.deepEqual(markdownCodeRanges(text),expected);
 assert.equal(markdownCodeCacheStatus().sourceParses,after.sourceParses);
 assert.equal(markdownCodeCacheStatus().skippedTextGroups,after.skippedTextGroups);
});
