import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,type Transaction} from '@codemirror/state';
import {insertNewlineAndIndent} from '@codemirror/commands';
import {language,syntaxTree,indentUnit} from '@codemirror/language';
import {highlightTree,classHighlighter} from '@lezer/highlight';
import {grammarRuntime} from './language-grammar-runtime';
import {codeLanguage,codeReadingFence} from '../code-language';

test('C source and headers use the C grammar without taking Markdown or C++ extensions',()=>{
  for(const extension of ['c','h','H'])assert.equal(codeLanguage(extension)?.grammar,'c');
  assert.equal(codeLanguage('md'),undefined);
  assert.notEqual(codeLanguage('cpp')?.grammar,'c');
});
test('C grammar highlights directives, types, strings and numbers and indents native Enter',async()=>{
  const support=await (await grammarRuntime()).loadCodeGrammar('c');
  const raw='#include <stdio.h>\r\nint main(void) {\r\n    const char *message = "hello";\n\treturn 0;\r\n}';
  const state=EditorState.create({doc:raw,extensions:[EditorState.lineSeparator.of('\n'),support,indentUnit.of('    ')]});
  assert.equal(state.facet(language),support.language);assert.equal(state.doc.toString(),raw);
  const styles=new Set<string>();highlightTree(syntaxTree(state),classHighlighter,(_from,_to,style)=>style.split(' ').forEach(s=>styles.add(s)));
  for(const kind of ['tok-keyword','tok-string','tok-number'])assert.ok(styles.has(kind),kind);
  const line='int main(void) {';let edited=EditorState.create({doc:line,selection:{anchor:line.length},extensions:[support,indentUnit.of('    ')]});
  assert.equal(insertNewlineAndIndent({get state(){return edited;},dispatch:(transaction:Transaction)=>{edited=transaction.state;}}),true);
  assert.equal(edited.doc.toString(),line+'\n    ');
  assert.ok(codeReadingFence(raw,codeLanguage('h')?.grammar).startsWith('```c\n'));
});
