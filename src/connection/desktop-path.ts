
/** Compare canonical native paths; both Windows and POSIX parent separators count. */
export function isPathInsideDirectory(root:string,path:string,paths:{relative:typeof import('node:path').relative;isAbsolute:typeof import('node:path').isAbsolute}){
  const part=paths.relative(root,path);
  return !part||!paths.isAbsolute(part)&&! /^\.\.(?:[\\/]|$)/.test(part);
}
