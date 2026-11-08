import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StreamingJson,omitImportField} from '../src/connection/streaming-json';

test('selection preserves exact values at every chunk boundary, including escapes and Unicode',()=>{
 const value={snapshotSequence:7,projection:{thread:{id:'thread'},runs:[],messages:[{text:'𐍈 café \\" quote"\n next',context:{ignored:true}}],subagents:[{result:'discard'}],turnItems:[],visibleTurnItems:[]},hasMoreHistory:false};
 const encoded=JSON.stringify(value),expected={...value,projection:{...value.projection,messages:[{text:value.projection.messages[0].text}]}} as Record<string,unknown>;
 delete (expected.projection as Record<string,unknown>).subagents;
 for(let boundary=0;boundary<=encoded.length;boundary++){
  const parser=new StreamingJson(omitImportField);parser.write(encoded.slice(0,boundary));parser.write(encoded.slice(boundary));assert.deepEqual(parser.finish(),expected);
 }
});

test('discarded multi-megabyte fields do not accumulate in the retained JSON',()=>{
 const parser=new StreamingJson(omitImportField);parser.write('{"projection":{"subagents":[{"result":"');
 for(let n=0;n<3000;n++)parser.write('x'.repeat(4096));
 assert.ok(parser.retainedCharacters<100);
 parser.write('"}],"thread":{"id":"source"},"messages":[{"text":"complete answer"}]}}');
 assert.deepEqual(parser.finish(),{projection:{thread:{id:'source'},messages:[{text:'complete answer'}]}});assert.ok(parser.retainedCharacters<200);
});

test('all omitted fields, arrays, nulls and primitive roots preserve valid JSON',()=>{
 for(const value of [{a:1,b:2},{a:{nested:[1,null,true,false,'text']},b:[]},[],{},null,true,5,'root']){
  const encoded=JSON.stringify(value),parser=new StreamingJson(path=>path[0]==='a');
  for(const char of encoded)parser.write(char);
  const expected=value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='a')):value;
  assert.deepEqual(parser.finish(),expected);
 }
});

test('malformed kept and discarded JSON fails without exposing response contents',()=>{
 for(const value of ['{"private":"secret"','{"a":1,}','[1,]','{"a":"bad\\q"}','{"a":"bad\n"}','{"a":tru}','{} {}','{}\u00a0','\ufeff{}']){
  const parser=new StreamingJson(path=>path[0]==='a');
  assert.throws(()=>{parser.write(value);parser.finish();},error=>error instanceof Error&&!error.message.includes('secret'));
 }
});
