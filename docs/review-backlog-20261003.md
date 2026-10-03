# Review backlog revalidation against 2.31.3

Baseline: `d0d28d4`, clean canonical checkout, seven pre-existing stashes retained.
The original report described an older writer and predates native coordinated
materialization. This implementation changes only reproduced current defects.

| Original finding | Current assessment and action | Acceptance / regression evidence |
| --- | --- | --- |
| 1. Shared settings overwrite | Still valid. Three-way leaf merge adopts remote preferences, preserves distinct nested edits and queued local changes; same-field conflicts prefer disk. Relation collections retain their existing protocols. Project-selection UI is retired. | `settings-conflict.test.ts`: external refresh, unrelated save, nested conflicts, queued reversal, folder stale-Sync and failure recovery. |
| 2. Completion triggers subscriptions | Still valid under native materialization. Filter final generated ranges using existing immutable journal intents, including pending post-write verification. Map only proven outside edits; changed/ambiguous ranges remain ordinary content. Legacy cleanup uses its existing exact prefix/body proof. Seed only after coordinator recovery. Live 2.31.4 smoke additionally proved that section anchor padding changed the watcher baseline; native insertion now adds no ordinary blank-line padding, and filtering consumes exactly the registration’s terminating newline. | `generated-note-coordinator.test.ts`: pending intent, restart, repeated identical independent results, staged table edits, outside edits, edited generated text, legacy proofs, marker examples inside code; `editor-stream.test.ts` verifies the real section insertion against the pre-registration watcher baseline. |
| 3. Mirrored continuation state | Original group-wide remedy superseded by explicit independent response/run registrations. `follow` and `steer` reserve the specifically selected registration; canonical incoming messages provide other bound views with sender-labelled same-run input. A future run is not silently attached to unrelated/completed registrations. Existing `stream-thread` explicitly attaches future runs. | `inline-lease.test.ts`: idempotent steering, stale-checkpoint fencing, changed-input rejection; `hosted-inline.test.ts`: explicit follow and transcript recovery; `chat-delivery.test.ts`: many-to-many mirrored sends/attachments and exact replay. No response-group machinery added. |
| 4. Unrelated runtime permissions | Still valid in direct and desktop new-thread paths. New threads now explicitly use `approval-required`. Existing-thread sends and saved retries keep their original permissions. | Direct/native lost-acknowledgement tests seed a permissive unrelated thread and verify conservative create/start commands; existing-thread preservation tests remain. |
| 5. Failed asset blocks final answer | Still valid. Each failed import preserves its original link, records a bounded non-sensitive failure receipt and adds one notice. Successful imports still render in position. Completion and cleanup proceed. Explicitly reattach the exact response to retry imports; finalized notes are not rewritten. | `hosted-inline.test.ts`: mixed success/failure, terminal completion and no repeated retry; existing reply-asset-import tests cover deterministic assets and text fallback. |
| 6. Move-back history loss | Still valid. Mutation timestamps advance beyond all known revisions without changing last-used ordering. Tombstones win equal-revision ties. Confirmed sends also advance history revisions. | `note-threads.test.ts`: note/folder round-trip, reload, stale records, deletion and clock rollback. |
| 7. Terminal payload retention | Still valid. Successful/discarded agent receipts retain command metadata and result/tombstone only; unresolved commands keep exact recovery payloads. Legacy terminal receipts compact on reload/replay. Successful desktop ledgers retain fingerprints/IDs, not commands or attachments. | `chat-delivery.test.ts`: success, legacy reload compaction, unresolved preservation, discard/replay refusal, changed-ID input rejection and lost acknowledgement; `native.test.ts`: terminal ledger inspection and replay. |
| 8. Plain immutable resume fails | Still valid. An immutable provenance sidecar binds the archive to its pre-release commit and exact original/generated version bytes. Plain resume permits only verified unstaged version edits and installs archive bytes in both vaults. Other edits/changed provenance refuse. | Python release fixture simulates post-packaging Sync failure, plain resume, unrelated source edits and altered version bytes. Older archives without provenance retain the conservative legacy path. |
| 9. Smoke accepts different bytes | Still valid. Before copying evidence or creating a receipt, compare all six QLO2 artifacts and all three development runtime artifacts with immutable deployment hashes. | Python test alters each same-version QLO2 artifact and verifies refusal without a smoke receipt/evidence copy; unchanged artifacts succeed. |
| 10. Misleading cleanup settings | Still valid. Rename to Legacy cleanup defaults and explain previously queued jobs; manual sends/questions keep notes. | Current send paths still use Keep; README and settings description agree. |
| Timing-sensitive waits | Replace short fixed waits for image-selection replies and multi-destination completion with bounded observable completion predicates. | Full suite plus direct/native/chat focused validation. |

The change preserves exact dispatch IDs, request fingerprints, routing refusal,
native rendering and saved projections, per-response and per-run identities,
incoming sender metadata, Missing 3 coverage, staged edits, deletion protection,
journals, and completed save/cleanup proofs. It does not migrate job queues or
alter active response blocks.

Real QLO2 delivery evidence and immutable release receipts are recorded outside
the vault under `~/backups/send-to-t3-code`. Unit fixtures are not live evidence.
Actual iPhone and multi-device Sync contention are waived release prerequisites
and remain unverified. Older completed text without a journal or saved position
proof is not classified through content guessing. Synced preferences have no
cross-device atomic compare-and-set transport: the field merge prevents stale
local overwrites but does not claim a global transaction across Sync clients.
