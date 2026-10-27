/** T3 message IDs are opaque tokens, including native MCP namespaces. They are
 * distinct from the plugin's UUID command, actor and response-binding IDs.
 * Keep the same bound used by local preview/context storage. The local
 * async-answer namespace has its own structured validation. */
export function isT3MessageId(value:unknown):value is string {
  return typeof value==='string'&&value.length>0&&value.length<=256&&
    !value.startsWith('async-answer:')&&!/[\s\p{C}]/u.test(value);
}
