import type {HostedInlineRequest} from './hosted-inline';
/** Guidance exposes the supported protocol. It does not sandbox tools. */
export function stagedNoteInstruction(bindings:readonly HostedInlineRequest[]){
 const native=bindings.filter(binding=>binding.nativeProjection);if(!native.length)return '';
 return '\n\nSupported coordinated note edits:\n'+native.map(binding=>`Destination ${binding.notePath}; binding ${binding.id}; host vault ${binding.host.workspaceRoot}.`).join('\n')+
 '\nTo edit one of these notes, run the Send to T3 Code scripts/obsidian-command.py CLI on its host with --vault HOST_VAULT stage-note-edit --binding-id BINDING_ID. Edit the returned stagingPath outside the live vault, then run submit-note-edit --binding-id BINDING_ID --hash ORIGINAL_HASH using the returned originalHash. The host combines the staged edit with the finished reply. This protocol preserves checked commits; direct filesystem edits bypass that guarantee. Do not change response anchors in the staged file.';
}
