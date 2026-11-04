import {Buffer} from 'buffer/';

/** A zero-copy browser Buffer view, retaining a sliced array's exact bounds. */
export function byteView(bytes:Uint8Array):Buffer{
  // buffer 6 supports ArrayBuffer and SharedArrayBuffer at runtime; its bundled
  // declaration predates ArrayBufferLike. No Node Buffer is loaded here.
  return Buffer.from(bytes.buffer as ArrayBuffer,bytes.byteOffset,bytes.byteLength);
}
