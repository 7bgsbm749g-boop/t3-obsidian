# Coordinated native response delivery

The production path renders the existing formatter's Markdown inside each native Obsidian view. `getViewData` supplies a separate saved projection with only empty, stable UUID marker pairs for active responses. CodeMirror transactions map selections and ordinary undo history without adding streaming updates to user history. Reading view and Source mode use the same native view adapter; no generic widget renderer is used.

`NativeResponseManager` owns independent adapters for all panes. Native cross-pane data echoes are normalized before the ordinary-text merge. Every save strips registered generated bodies from the current displayed document, rather than replacing the whole note with an old snapshot. Missing, duplicated or nested boundaries preserve a device-local conflict snapshot and block the unsafe save. Unload strips transient output. A conflicting local version remains in device-local recovery storage; unloading adopts the incoming version so it cannot silently overwrite that competing version. A verified final commit resolves a matching incoming materialization; unrelated conflicts remain preserved.

The host advertises native coordination through its private authenticated file transport. Clients retain the previous behavior with older hosts. The existing desktop host lock admits one authority. Native registrations use a non-expiring host owner, and device claim commands are rejected. Device timers poll response state and reconnect; they no longer elect or renew a response writer. The host keeps bounded canonical snapshot reads and exact per-request start/binding evidence. Each independently registered destination keeps its own UUID, thread, message, author, provenance, run associations, formatting preferences and lifecycle.

Legacy active responses migrate only when saved content is a known checkpoint and every source pane agrees with disk. The authority first advances the epoch and fences the old device writer and waits out its previously granted cached TTL before stripping saved bytes. Original migration bytes are preserved outside the vault before the checked native save replaces the body with its empty anchor. An interrupted migration resumes from the durable fence/journal. Unknown, paused, damaged or completed-cleanup registrations retain their recovery behavior; restoring intact boundaries and `resume-response` allows another checked migration attempt. Registrations and requests are not regenerated during migration.

## Supported staged edits and final commit

`stage-note-edit` returns an isolated `staged.md` path and the original checksum. `submit-note-edit` reads that file, rejects changed identities or response boundaries, and journals the proposed note version. The original, proposed edits, checkpoints, final response, immutable write intents, readback results, conflicts, explicit removal and repairs form a hash-chained journal outside all registered synced vaults. On the VPS, journals are under `~/backups/send-to-t3-code/coordinated-journals/`.

The host serializes generated commits per note. The final response and staged note edits form one compare-and-set save, followed by actual saved-file readback. Unique unchanged lines prove separated ordinary edits; repeated/reordered or touching edits are treated conservatively. Every participating native saved projection, file identity and host lifetime is checked immediately before mutation. A durable materialization intent is installed in native views before Obsidian emits its file update. No completion proof cleanup write is needed for native deliveries.

This protocol does **not** sandbox tools. Arbitrary privileged tools, shell commands or direct vault edits can bypass staging; those writes are outside its guarantee. Sending a workspace path or prompt instruction is not access enforcement. The user explicitly authorized shipping this supported protocol without a new T3 sandbox contract on 2026-10-03.

## Verification and conservative recovery

Host-verified and device-observed delivery are separate fields. A device sends an acknowledgement only after reading the saved file and matching the commit checksum. Host readback alone never invents another device's acknowledgement. Observation continues for journaled completed responses. Changes outside the committed generated ranges are preserved; changed or missing generated results retain original/latest/proposed evidence as a conflict. A disappearance by itself cannot prove whether it was stale Sync or an intentional deletion/undo, so it is not automatically restored. An exact pending write found after restart is verified from disk before any marker locator or native-view projection runs. Its immutable write intent proves the landed bytes, and an epoch/revision-fenced checkpoint propagates finalSaved, cleanupComplete and the exact completed turn without another note write. Pending acknowledgement and preserved edit conflict are separate states. Explicit repair compares a reviewed current checksum before merging and readback. Explicit removal leaves a tombstone and prevents restoration.

Commands use the normal immutable request/result bridge. Run on the vault host:

```sh
python3 scripts/obsidian-command.py --vault /path/to/vault response-status --binding-id UUID
python3 scripts/obsidian-command.py --vault /path/to/vault stage-note-edit --binding-id UUID
python3 scripts/obsidian-command.py --vault /path/to/vault submit-note-edit --binding-id UUID --hash ORIGINAL_HASH
python3 scripts/obsidian-command.py --vault /path/to/vault repair-response --binding-id UUID --hash REVIEWED_CURRENT_HASH
python3 scripts/obsidian-command.py --vault /path/to/vault remove-response --binding-id UUID
python3 scripts/obsidian-command.py --vault /path/to/vault resume-response --binding-id UUID
```

The command palette’s **Resolve response view conflict…** offers saved or preserved local text for any conflicting pane of the active note, including a background pane. Both versions and the explicit choice remain in device-local storage; the saved revision is rechecked before applying the choice.

`response-status` provides the conflict versions and verified commit. For a pending commit, repair requires the reviewed hash and disk bytes to match the immutable expected result, then runs the same genuine readback recovery. Exact identical ordinary edits (including independent response registrations) already included in a final save are deduplicated; other touching edits remain conflicts. Repair refuses an overlap or a changed reviewed revision; it does not overwrite arbitrary competing edits. `resume-response` requires intact unique boundaries and agreement between native panes and saved marker identities. Reuse request UUIDs with identical arguments for retries.

## Destination sections and mirror reliability

`send-note`, `attach-response` and `stream-thread` accept `--destination-section 'Exact heading'`. Placement uses a unique ATX heading outside code, before its next sibling/parent heading. It uses the normal editor/atomic note path and preserves all text outside the insertion. The binding ID and any per-run registration remain independent of section placement. Missing or duplicate headings fail instead of selecting a guessed section.

The historical Ready failure cannot be attributed conclusively to a specific client operation. Two concrete writer gaps were reproduced: an open stale buffer hid intact disk markers, and a multi-view update changed only the first editor. The updated note IO retries marker disagreement against disk, synchronizes equal native source views and refuses divergent panes. This makes raw filesystem relocation unnecessary; it does not claim raw moves while an editor is open are transactional.

## Validation coverage

The linked 2026-10-02 formatting investigation established native rendering parity and rejected the generic widget approach. New isolated real Obsidian fixtures compare the same 78 formatting cases across Live Preview, Reading view, Source mode and two narrow widths, and test autosave, native selection, questions, folding, ordinary undo/redo, view switching, incoming updates, two panes, dirty-pane final-save delays and staged table-plus-response materialization. Unit/integration tests cover host protocol, exact provenance, migration fences, restart readback, conservative conflicts, repair, removals and saved-file acknowledgements.

Actual iPhone testing and multi-device real Sync contention were explicitly waived as release prerequisites. They remain coverage limits. The normal QLO2 release must still complete immutable packaging, both installations with unchanged `data.json`, a fresh fully synced scan, native real QLO2 reload, bounded real T3 delivery and immutable smoke evidence before delivery is claimed.

The 2.31.2 recovery regression reproduces independent registrations appended after the generation original, native final materialization, interrupted post-save acknowledgement, restart, honest completion propagation and late saved-file acknowledgement. It also verifies another section-targeted insertion after recovery. No private lease or journal records are reset.
