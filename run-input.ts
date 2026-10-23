import type {InlineMessage} from './inline-thread';

/** Provider and system notices can use the user role without being run prompts.
 * Use their origin, so a real prompt can quote the same notification text. */
export function isRunInput(message:InlineMessage):boolean {
  return message.role==='user'&&message.createdBy!=='system'&&message.creationSource!=='provider';
}
