/* eslint obsidianmd/no-nodejs-modules: ["warn", {"isDesktopOnly": true}] -- This desktop adapter is lazy-loaded; scripts/check-platform-boundaries.mjs and mobile bundle tests prohibit Node imports in the portable entry graph. */
import {createHash} from 'node:crypto';
import {installContentHasher} from '../responses/completion';

/** OpenSSL consumes the string directly, avoiding the portable SHA loop and
 * its full-size temporary Uint8Array. Hash bytes and formatting stay identical. */
export function installDesktopContentHash(){
  return installContentHasher(text=>createHash('sha256').update(text,'utf8').digest('hex'));
}
