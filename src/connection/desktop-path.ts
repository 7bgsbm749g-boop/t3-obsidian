/* eslint obsidianmd/no-nodejs-modules: ["warn", {"isDesktopOnly": true}] -- This desktop adapter is lazy-loaded; scripts/check-platform-boundaries.mjs and mobile bundle tests prohibit Node imports in the portable entry graph. */
import {relative,isAbsolute} from 'node:path';

/** Compare canonical native paths; both Windows and POSIX parent separators count. */
export function isPathInsideDirectory(root:string,path:string,paths:{relative:typeof relative;isAbsolute:typeof isAbsolute}={relative,isAbsolute}){
  const part=paths.relative(root,path);
  return !part||!paths.isAbsolute(part)&&! /^\.\.(?:[\\/]|$)/.test(part);
}
