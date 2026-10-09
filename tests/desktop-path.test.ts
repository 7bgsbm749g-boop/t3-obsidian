import {test} from 'node:test';
import assert from 'node:assert/strict';
import {win32,posix} from 'node:path';
import {isPathInsideDirectory} from '../desktop-path';

test('Windows private mailbox and journal paths outside a vault are permitted',()=>{
  const vault='C:\\Users\\jacks\\Documents\\QLO2';
  assert.equal(isPathInsideDirectory(vault,'C:\\Users\\jacks\\.t3\\send-to-t3-code\\vaults\\private',win32),false);
  assert.equal(isPathInsideDirectory(vault,'C:\\Users\\jacks\\Documents',win32),false);
  assert.equal(isPathInsideDirectory(vault,'C:\\Users\\jacks\\Documents\\QLO2-other',win32),false);
  assert.equal(isPathInsideDirectory(vault,'D:\\private',win32),false);
});
test('Windows containment still rejects the vault itself and descendants',()=>{
  const vault='C:\\Users\\jacks\\Documents\\QLO2';
  assert.equal(isPathInsideDirectory(vault,vault,win32),true);
  assert.equal(isPathInsideDirectory(vault,'c:/users/jacks/Documents/QLO2/private',win32),true);
  assert.equal(isPathInsideDirectory(vault,vault+'\\..cache',win32),true);
  assert.equal(isPathInsideDirectory('\\\\server\\share\\vault','\\\\server\\share\\private',win32),false);
  assert.equal(isPathInsideDirectory('\\\\server\\share\\vault','\\\\server\\other\\private',win32),false);
  assert.equal(isPathInsideDirectory('\\\\server\\share\\vault','\\\\server\\share\\vault\\private',win32),true);
});
test('POSIX containment permits parents and siblings while rejecting descendants',()=>{
  assert.equal(isPathInsideDirectory('/vault','/vault',posix),true);
  assert.equal(isPathInsideDirectory('/vault','/vault/private',posix),true);
  assert.equal(isPathInsideDirectory('/vault','/vault/..cache',posix),true);
  assert.equal(isPathInsideDirectory('/vault','/private',posix),false);
  assert.equal(isPathInsideDirectory('/vault','/',posix),false);
});
