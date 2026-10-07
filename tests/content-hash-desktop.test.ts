import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '@noble/hashes/sha256';
import {contentHash,installContentHasher} from '../completion';
import {installDesktopContentHash} from '../content-hash-desktop';

const portable=(text:string)=>Buffer.from(sha256(new TextEncoder().encode(text))).toString('hex');

test('native fingerprints match portable UTF-8 bytes including malformed UTF-16 and large whitespace-rich bodies',()=>{
  const texts=['','abc','café 🧪\r\n','\t    x\r\ny\n','\0\u0001','\ud800','\udfff','\ud800x\udc00','\ud800\udc00',
    '    function f() {\r\n\treturn "🧪";\r\n}\n'.repeat(20000)];
  let seed=12345;
  for(let i=0;i<100;i++){
    let value='';for(let j=0;j<1000;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;value+=String.fromCharCode(seed>>>16);}texts.push(value);
  }
  const expected=texts.map(portable),stop=installDesktopContentHash();
  try{for(let i=0;i<texts.length;i++)assert.equal(contentHash(texts[i]),expected[i]);}finally{stop();}
  assert.equal(contentHash('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('an old plugin disposer cannot clear a newer installed hash implementation',()=>{
  let firstCalls=0,lastCalls=0;
  const first=installContentHasher(text=>{firstCalls++;return portable(text);});
  assert.equal(contentHash('a'),portable('a'));
  const last=installContentHasher(text=>{lastCalls++;return portable(text);});
  first();assert.equal(contentHash('b'),portable('b'));assert.equal(firstCalls,1);assert.equal(lastCalls,1);
  last();assert.equal(contentHash('c'),portable('c'));assert.equal(lastCalls,1,'unload restores the portable path');
});
