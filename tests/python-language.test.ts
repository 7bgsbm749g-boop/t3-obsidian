import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,type Transaction} from '@codemirror/state';
import {insertNewlineAndIndent} from '@codemirror/commands';
import {language,syntaxTree,indentUnit} from '@codemirror/language';
import {highlightTree,classHighlighter} from '@lezer/highlight';
import {grammarRuntime} from './language-grammar-runtime';
import {codeLanguage,codeReadingFence} from '../code-language';

test('Python grammar handles type stubs, annotations, strings and nested indentation',async()=>{
  const support=await (await grammarRuntime()).loadCodeGrammar('python');
  const raw='from typing import Protocol\r\n\r\nclass Reader(Protocol):\r\n    def read(self, count: int = 1) -> str: ...\n    label: str = "raw value"';
  const state=EditorState.create({doc:raw,extensions:[EditorState.lineSeparator.of('\n'),support,indentUnit.of('    ')]});
  assert.equal(state.facet(language),support.language);assert.equal(state.doc.toString(),raw);
  const tree=syntaxTree(state),errors:string[]=[];tree.iterate({enter:node=>{if(node.type.isError)errors.push(node.name);}});assert.deepEqual(errors,[]);
  assert.match(tree.toString(),/ClassDefinition/);assert.match(tree.toString(),/FunctionDefinition/);assert.match(tree.toString(),/TypeDef/);
  const classes=new Set<string>();highlightTree(tree,classHighlighter,(_from,_to,style)=>style.split(' ').forEach(name=>classes.add(name)));
  for(const kind of ['tok-keyword','tok-string','tok-number'])assert.ok(classes.has(kind),kind);
  const line='def read(count: int) -> str:';
  let edited=EditorState.create({doc:line,selection:{anchor:line.length},extensions:[support,indentUnit.of('    ')]});
  assert.equal(insertNewlineAndIndent({get state(){return edited;},dispatch:(transaction:Transaction)=>{edited=transaction.state;}}),true);
  assert.equal(edited.doc.toString(),line+'\n    ');
  const stub=codeLanguage('pyi');assert.equal(stub?.grammar,'python');assert.ok(codeReadingFence(raw,stub?.grammar).startsWith('```python\n'));
});
