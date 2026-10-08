# Device response completion

New native responses negotiate `deviceCompletion: 1` with the vault host. Streaming remains native, local and excluded from saved Markdown. The sending device can save the final response without a Sync round trip. The host remains the registration, exact-binding and final-grant authority. Existing registrations, old hosts and old sending devices retain their previous completion path.

## Why the previous design used the host

The settled `2.31.0-3 Arms` investigation recorded a correct VPS completion followed by later damaged phone uploads containing stale Working/table text. The selected prevention kept streaming out of saved Markdown and used one checked final writer. It also coordinated staged note edits with the reply. A streaming heartbeat takeover alone could not protect against a stale editor writing later. App lock was explicitly rejected as the cause.

The settled `2.14.1` handoff requirements still require closed-note completion, app-close fallback, fenced returning writers, genuine saved-file verification, and bounded final attachment imports. The `2.30.13-14` and `2.29.6-7` investigations require exact prompt/start/turn associations, canonical freshness when live feeds stall, and explicit question continuation. The `2.31.4-5` review requires generated output filtering before final acknowledgement, observable ordinary edits, independent destinations, rename and removal protection, and immutable releases. This change preserves those requirements.

## One durable final writer

The registration carries only a stable device UUID and the original checksum. The full original is retained in an immutable private `originals/BINDING.md` sidecar, outside Sync. The actor survives plugin reload; the earlier per-load writer identity remains in use for legacy leases.

Before a final grant, sender presence is renewed every three seconds and expires after fifteen seconds. A closed destination note can still finish. If the sending app stops before reserving completion, the host can take the final grant after presence expires. Explicit Stop permits the existing bounded host cleanup without waiting for presence. Presence does not grant note-write authority.

A final grant is permanent and never expires. Once a device has it, delayed saves, app suspension, acknowledgement loss and reload cannot authorize a competing host write. The grant binds an exact message, completed/interrupted turn, canonical sequence and immutable final body. Direct terminal events require a fresh bounded canonical read before saving. Host canonical evidence supplies the same exact completion when the direct feed is recovering. Session-ready alone cannot seal a streaming commentary message.

Final references use the existing bounded attachment importer before reservation. Staged edits are frozen when completion is reserved. Each destination keeps its own UUID, request, original, grant and result. The existing renderer, Raw Markdown option, progress history, selection receipts, questions, steering and Stop/Continue behavior remain in use.

## Checked local save and recovery

The device uses `GeneratedNoteCoordinator` with a private IndexedDB journal. It merges separated ordinary changes, confirmed selection removal, staged edits and the final response into one compare-and-set save. Touching, ambiguous or competing changes preserve both versions and open the existing native conflict recovery. Every native pane, file identity and disk revision is checked before mutation; a native autosave timeout is not part of successful completion.

The device journals the exact intended bytes and publishes their immutable materialization proof before changing the note. The host excludes the proven response range from subscription events even if the file arrives before the completion receipt. Staged ordinary edits remain observable. A missing or changed proof cannot classify arbitrary text as generated output.

Actual disk readback verifies the local save. The editor adopts the result locally before Sync or the final receipt. The receipt reports the sending actor and `verifiedOnHost: false`. A retry after reload reuses the same grant and journal. An exact pending save is recovered by readback; duplicate receipts do not reinsert the response or replace later user edits/deletion. Native completion tombstones and materialization proofs prevent stale anchors from overwriting a verified final note after reload.

The host retains its private journal, completed-response controls and immutable proof. It adopts a device receipt without another note write. Other clients retain the final display until their own saved note arrives and conservatively matches the proof. History removal and later edits retain existing checks.

## Latency and verification limits

This removes Obsidian Sync from the sending device's final-save path. Canonical T3 verification, private grant/intent operations, final asset imports and local disk IO remain required; it is not a claim of zero network or storage latency. A paused sender after a grant must recover on that device rather than create a second writer.

Tests cover missing host notes, closed destinations, permanent grants, expired presence fallback, early Stop, canonical final-message freshness, staged/ordinary conflicts, storage failure before mutation, interrupted readback/receipt, local journal discovery, native panes and stale anchors, generated-event filtering before receipt, independent responses and checked history removal. The full repository suite and real native QLO2 delivery remain release requirements.

The synthetic Sync lab uses two independent desktop editors and official Headless Sync. File propagation, visible editor adoption and sender completion while Sync is stopped must be reported separately. It does not prove desktop core Sync engine behavior or native iPhone/Android behavior. Native mobile verification remains a coverage limit.
