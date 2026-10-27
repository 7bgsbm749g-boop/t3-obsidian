export type ThreadTitleGeneration = 'untitled-only' | 'always';
export const AUTO_THREAD_TITLE = 'New thread';

export function threadTitleGeneration(value:unknown):ThreadTitleGeneration {
  return value==='always'?'always':'untitled-only';
}

/** T3's launch service generates a title from its first message for this placeholder. */
export function noteThreadTitle(notePath:string|undefined,mode:ThreadTitleGeneration):string {
  const basename=notePath?.split('/').at(-1)?.replace(/\.md$/i,'').trim();
  return mode==='always'||!basename||/^untitled(?: \d+)?$/i.test(basename)
    ? AUTO_THREAD_TITLE : basename.slice(0,160);
}
