import {createHash} from 'node:crypto';
import {installContentHasher} from './completion';

/** OpenSSL consumes the string directly, avoiding the portable SHA loop and
 * its full-size temporary Uint8Array. Hash bytes and formatting stay identical. */
export function installDesktopContentHash(){
  return installContentHasher(text=>createHash('sha256').update(text,'utf8').digest('hex'));
}
