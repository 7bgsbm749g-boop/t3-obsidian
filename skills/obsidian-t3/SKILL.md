---
name: obsidian-t3
description: "Edit Obsidian notes through the t3-obsidian MCP tools when a message sent from Obsidian asks for note changes. Use for creating, editing, moving, renaming or settling notes. A source footer alone does not request a note edit; normal conversation replies stream into Obsidian automatically."
---

# Checked Obsidian note edits

Use the `t3-obsidian` MCP tools for a requested note change. `Sent from Obsidian.`,
`Vault:` and `Note:` identify the source. A source footer alone grants no editing
permission. For an ordinary answer, reply in the current conversation: the plugin
streams and saves it. Do not append another copy to the note.

The MCP server runs on the T3 machine. The running Obsidian plugin receives its
requests through authenticated T3 Connect and uses native editing APIs. Keep
Obsidian open and connected to the machine running these tools. Mobile delivery
while the app is in the background is not guaranteed.

## Choose the exact client and note

Use the exact `vault` name or UUID from the source context. If several clients
match, call `connected_clients` and select the intended `clientId`. Never send
the same edit to multiple devices, guess another vault after a failed lookup,
or use direct filesystem edits to bypass a refusal.

For a request about a sent note or its reply, call `note_context` with `notePath`
or exact `threadId`, `messageId` and `environmentId`. The source note and reply
destination can differ. Use the returned destination path and binding UUID; a
thread ID is not a response binding.

## Prepare and submit

1. Call `prepare_note_edit` with the exact `notePath`. Include `bindingId` for
   an active response. This returns `editId`, `original`, `originalHash`, and
   protected response IDs. Use that original text as the editing base.
2. Change only the requested ordinary note content. Preserve all active reply
   frames, their boundaries, bytes, and order exactly. Do not incorporate your
   still-streaming answer into a second copy of the note.
3. Call `submit_note_edit` with `editId`, the returned `originalHash`, and the
   complete `proposed` Markdown (at most 1 MB). Use a stable `requestId` UUID.

For an ordinary note, a successful checked write can report `saved` immediately.
For a streaming reply, `submitted` means the proposal is attached to the safe
final save. It does not mean the note has been saved. Submit before finishing
the current reply; waiting inside that reply for its own final save would prevent
completion. Report the confirmed state accurately. `note_edit_status` can later
confirm the actual save.

Compatible user edits made since preparation are merged. Overlapping changes
preserve both versions and block the save. Stop still reaches T3 and retains the
frozen reply for the same checked save path. If a reply finished, moved or changed
before submission, prepare the current note again and review the retained
proposal. Never force a raw vault write.

Unconfirmed commands return their request UUID. Reuse the exact `requestId` and
input; do not issue the same mutation under a new UUID. Set `retry` only after a
confirmed failure and inspection. Ambiguous execution cannot automatically replay.
Keep IDs unique across different operations; completed receipts are retained
for 24 hours.

## Create, move or rename

`create_note` takes an exact new `notePath` and complete `proposed` Markdown.
The parent folders must exist. Existing destinations and response frames are
refused. `rename_note` takes the source `notePath`, new `destination`, and its
current `originalHash` from preparation. Obsidian performs the rename and native
link updates. Rename before preparing a content proposal for the new path.

For a request to settle a note, use the project's existing Settled folder and
prepend the version actually delivered to its existing title. Preserve content
and response anchors. A move does not require an unrelated content change.

## Conflicts and retained replies

`note_edit_status` returns the current note checksum. After inspecting the note,
`cancel_note_edit` with `editId` and `hash` withdraws only the pending proposal;
it does not undo saved text. `response_recovery_info` returns the current hash
for a frozen reply. After reviewing conflicts, `retry_response_save` with the
exact `bindingId` and `hash` retries its checked save without another prompt or
remote Stop. None of these commands force an overwrite.

## Other requested operations

`send_note` starts T3 work and requires an explicit request to send a note.
`attach_response` imports an existing exact thread/message without a new prompt.
Do not use either to save a normal conversation answer. Read-only `client_status`
and `response_status` check the selected client or response. `inspect_folder`,
`link_folder`, and `unlink_folder` manage an explicitly selected folder's project
routing. Linking requires verified project, connection and environment IDs.

If these MCP tools are unavailable, the plugin's Settings → Connection → Agent
tools can configure Codex or Claude Code on the selected T3 machine. A new agent
session loads the setup. Do not silently substitute the old local server,
Obsidian CLI, vault scans, or Sync as a command queue.
