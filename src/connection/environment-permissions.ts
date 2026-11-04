/** Remote notes and reply mailboxes use filesystem RPC as well as orchestration. */
export const PLUGIN_PERMISSIONS=['orchestration:read','orchestration:operate','filesystem:read','filesystem:write'] as const;
export const PLUGIN_SCOPE=PLUGIN_PERMISSIONS.join(' ');

export function hasPluginPermissions(session:{permissions?:readonly string[]}|undefined){
  return Array.isArray(session?.permissions)&&PLUGIN_PERMISSIONS.every(permission=>session.permissions!.includes(permission));
}
