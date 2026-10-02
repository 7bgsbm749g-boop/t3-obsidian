import {responseActivityRow} from '../response-activity';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {escapeReplyHtml} from '../reply-html';
import {renderInlineTurn} from '../inline-thread';

test('HTML becomes literal while code, autolinks and link destinations retain exact bytes',()=>{
  const input='**<folder name>** <br> <span class="x">text</span>\n\n<!-- comment -->\n\n`<tag>` and ``<tag ` attr>``\n\n```html\n<div>example</div>\n```\n\n<https://example.com> <person@example.com> [site](<https://example.com>) ![image](<https://example.com/img>)\n\n[<tag>](<https://example.com>)';
  const output=escapeReplyHtml(input);
  assert.equal(output,input.replace('**<folder name>** <br> <span class="x">text</span>','**\\<folder name>** \\<br> \\<span class="x">text\\</span>').replace('<!-- comment -->','\\<!-- comment -->').replace('[<tag>]','[\\<tag>]'));
  assert.equal(escapeReplyHtml(output),output);
});

test('partial streamed tags, declarations and escaped delimiters are handled without changing source state',()=>{
  for(const tag of ['<f','<folder','<folder name','<folder name>','</span','<!DOCTYPE html>','<?xml version="1.0"?>'])assert.equal(escapeReplyHtml(tag),'\\'+tag);
  assert.equal(escapeReplyHtml('\\<tag>'), '\\<tag>');
  assert.equal(escapeReplyHtml('\\\\<tag>'), '\\\\\\<tag>');
  assert.equal(escapeReplyHtml('a < b and x <3'),'a < b and x <3');
});

test('renderer preserves quote paragraphs, bold and lists in running, final and continued replies',()=>{
  const text='**New project: <folder name>** before creation.\n\nNext **paragraph**.\n\n- **First**\n- Second';
  const message={id:'answer',role:'assistant',turnId:'turn',text,streaming:false};
  const state={messages:[message],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'answer'}};
  const expected='> **New project: \\<folder name>** before creation.\n>\n> Next **paragraph**.\n>\n> - **First**\n> - Second\n';
  assert.equal(renderInlineTurn(state,'turn','thread','complete'),expected);
  assert.ok(renderInlineTurn(state,'turn','thread','running').endsWith(expected+'\n\n'+responseActivityRow()+'\n'));
  assert.equal(renderInlineTurn(state,'turn','thread','complete',true,undefined,{messages:[message],steering:[]}),expected);
  assert.equal(message.text,text);
});

test('HTML blocks cannot swallow protection for subsequent fenced and inline code',()=>{
  const text='<div>\n```html\n<span>Code</span>\n```\nUse `<tag>` literally.\n</div>';
  assert.equal(escapeReplyHtml(text),text.replace('<div>','\\<div>').replace('</div>','\\</div>'));
});
