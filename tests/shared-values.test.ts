import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasControlCharacters,replaceControlCharacters,toError,errorCode,isRecord} from '../src/shared/values';
import {byteView} from '../src/shared/bytes';

test('control validation retains ASCII rejection, optional DEL and Unicode text',()=>{
  for(let code=0;code<32;code++){
    const text=`before${String.fromCharCode(code)}after`;
    assert.equal(hasControlCharacters(text),true);
    assert.equal(replaceControlCharacters(text),'before after');
  }
  assert.equal(hasControlCharacters('café 🧪'),false);
  assert.equal(replaceControlCharacters('café 🧪'),'café 🧪');
  assert.equal(hasControlCharacters('one\x7ftwo'),false);
  assert.equal(hasControlCharacters('one\x7ftwo',true),true);
  assert.equal(replaceControlCharacters('one\x7ftwo',true),'one two');
});

test('error boundaries preserve typed identity, abort identity and the original cause',()=>{
  const error=Object.assign(new Error('retry later'),{code:'ENOENT'});
  assert.equal(toError(error),error);assert.equal(errorCode(error),'ENOENT');
  const abort={name:'AbortError',message:'cancelled',code:'ABORT_ERR'};
  const normalized=toError(abort);assert.equal(normalized.name,'AbortError');assert.equal(normalized.cause,abort);
  assert.equal(toError('failed').message,'failed');assert.equal(toError(undefined).message,'Unknown error');
  assert.equal(errorCode(null),undefined);assert.equal(isRecord([]),false);
});

test('portable encoding uses the exact byte slice without a second payload copy',()=>{
  const source=new Uint8Array([0,65,66,67,0]),bytes=source.subarray(1,4),view=byteView(bytes);
  assert.equal(view.toString('base64'),'QUJD');assert.equal(view.buffer,source.buffer);
  source[2]=90;assert.equal(view.toString(),'AZC');
  if(typeof SharedArrayBuffer!=='undefined'){
    const shared=new Uint8Array(new SharedArrayBuffer(2));shared.set([65,66]);assert.equal(byteView(shared).toString(),'AB');
  }
});
