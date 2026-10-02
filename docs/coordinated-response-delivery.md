# Coordinated response delivery — source-only implementation

Status: incomplete, not activated or released. The live plugin remains on the existing response lifecycle. This code does not replace device writer election, touch active Ready mirrors, change installed data.json, or alter job settlement.

## Implemented components

- `native-response-projection.ts`: stable existing inline identities, structural marker validation (including literal examples in code), transient native Markdown, saved projection, explicit display/saved mappings, and protected generated ranges. Formatting still comes from `renderInlineTurn` without a widget or stylesheet rewrite.
- `native-response-view.ts`: instance-scoped native save/load boundary, compatible incoming/local edits, preserved competing versions on conflict, selection mapping, generated updates excluded from native undo history, transaction filtering, and journal-authorized final materialization. Incoming final bytes can arrive synchronously during `vault.process`; the write intent is installed first, while delivery still requires independent readback.
- `coordinated-merge.ts`: conservative three-way merging in saved coordinates. A changed interval spans all changes between its first/last character. This deliberately rejects some compatible multi-hunk changes rather than guessing repeated-text locations or interleaving overlapping changes.
- `generated-note-coordinator.ts`: independent response registrations, per-note serial commit queues, originals/checkpoints/results, combined staged patch and existing-format final response, write-ahead commit identities, compare-and-set seam, exact disk readback, crash recovery without duplicate writes, explicit removal, later-loss detection, and checked explicit repair. VPS verification and per-device acknowledgement are distinct states. Acknowledgement transport/authentication is not wired to devices.
- `generation-journal-desktop.ts`: immutable exclusive publications, fsync, a checksum chain and predecessor checks, private storage outside configured vault roots, and immutable original request/snapshot evidence. Deployment must provide all synced roots and hold the existing host lock.
- `coordinated-migration.ts`: pure migration planning that retains the exact legacy lease/checkpoint/author/provenance records and preserves outside note content. Unknown, terminal, ambiguous or unfinished-cleanup records stay with the legacy writer. Plans are not applied.
- `coordinated-delivery-gates.ts`: explicit unavailable state. There is no settings toggle or production entry point that enables these components.

The source is a reviewable prototype of the proposed core, not the full production replacement. It does not dispatch staged agents or register itself from `main.ts`.

## Execution boundary investigation

The current plugin dispatch path and available local T3 source were inspected, not inferred from a prompt. The running service uses `/home/ubuntu/.t3/runtime/versions/0.0.43-nightly.20260925.2251/t3`; the inspected source checkout is at commit `8d30dae73`. The running executable was also inspected: its embedded `ThreadTurnStartCommand` schema and `runtimeModeToTurnSandboxPolicy` confirm the same limitation. The executable checksum and exact embedded snippets are preserved in the final probe's `boundary-and-platform-evidence.json`. No enforcement contract is present in the plugin transport:

- `direct.ts:sendDirect` and `desktop.ts:sendDesktop` inherit the current thread runtime mode.
- `/home/ubuntu/projects/t3-code-forklauncher/packages/contracts/src/orchestration.ts`, `ThreadTurnStartCommand` exposes `runtimeMode`, message/context/model and bootstrap. It has no per-run writable roots, protected note paths or denied vault mounts.
- `/home/ubuntu/projects/t3-code-forklauncher/apps/server/src/provider/Layers/CodexSessionRuntime.ts`, `runtimeModeToThreadConfig` and `runtimeModeToTurnSandboxPolicy` map to read-only, workspace-write or danger-full-access. Full access permits arbitrary live-vault writes. The workspace-write modes retain permission escalation. No supported dispatch contract exposes an immutable live-vault exclusion with only the stage writable.

A stage directory, changed cwd/project, prompt instruction, watcher that notices a write, or rollback after a write is insufficient. This running job itself has danger-full-access. No permission settings, T3 server code, provider configuration or global runtime mode was changed.

Required upstream work: a supported run-scoped execution boundary covering shell/file tools and any other write-capable integrations, an immutable exclusion for live managed notes/vaults, access only to the requested stage for generated note edits, and verified write-denial evidence. Existing active conversations need an admitted continuation path without bypassing the exclusion. Until that exists, plugin dispatch cannot honestly enforce staging.

## Native validation

`npm run validate:native:prepare -- /absolute/new/private/evidence-directory` builds an independent unsynced fixture vault. Launch its returned profile in real Obsidian using Cua Driver; explicitly trust this authored fixture when prompted. It never installs into the development or QLO2 vault and refuses source/synced output roots, including symlink aliases. It records matrix measurements, screenshots, native saves/undo/redo/selection, and a bounded real native table-patch-plus-response commit with an outside-vault stage/journal. The probe dispatches no agent and labels the execution boundary as unenforced.

The earlier investigation was read before implementation: `/home/ubuntu/backups/send-to-t3-code/format-parity-20261002/REPORT.md`, its aggregate evidence and native probe sources, plus the linked QLO2 attachment `db2252b9da197465-REPORT.md`. Its 78 desktop cases are prior feasibility evidence, not new implementation/mobile evidence.

New run directories preserve failures instead of replacing them:

- `coordinated-response-20261002-source-1`: 72 exact layout/display/save cases; autosave check sampled too early. Ordinary undo/redo and selection passed.
- `coordinated-response-20261002-source-2`: exposed synchronous final-file delivery before the readback return, now handled with a write-ahead materialization intent.
- `coordinated-response-20261002-source-3`: prepared fixture, never launched.
- `coordinated-response-20261002-source-4`: 72 exact layout/display/save cases plus six matching rich/control cases; exposed an out-of-date saved baseline after ordinary autosave. The adapter now adopts a saved baseline only after disk readback.
- `coordinated-response-20261002-source-5`: prepared/launched fixture, not enabled after the lifecycle filter was consolidated.
- `coordinated-response-20261002-source-6`: final native acceptance probe. Its `done.json`, `matrix.json`, `rich.json` and `edges.json` record all 78 exact native layout/display/save cases, matching Answer controls, and all ten native editing/save checks passing. The bounded table patch and final response used one `vault.process` write and independent readback, commit `33f8a59b-d0c8-4d81-9c9d-c42486e449a9`, SHA-256 `f094fa9bd27807ac340835a19b70f4347a4bbd1fa9729c1860ae28051415a7c1`, with no device acknowledgements and no enforced agent boundary. `npm run build` and the full `npm test` passed (601 TypeScript tests and six release-tool tests).

All directories are outside vaults under `/home/ubuntu/backups/send-to-t3-code/`. They are validation evidence, not immutable release/smoke receipts.

## Remaining delivery blockers

1. The execution boundary above is unavailable in the supported T3 dispatch API.
2. Actual iPhone validation is unavailable: `device_list` returned `Agent device access is turned off for this environment.` A narrow desktop pane or simulator would not establish physical iPhone keyboard/editor behavior.
3. Production wiring remains: native per-view lifecycle registry, simultaneous view reconciliation and shutdown conflict handling, saved-coordinate use throughout selection/steering/destination commands, Stop/Continue control integration, durable subscription transport, canonical host-only generation and per-device acknowledgements.
4. Migration must fence old grants/writers before changing active note bodies. A migration plan or retained lease snapshot alone does not fence an old phone plugin. Ready mirrors, many-to-many destinations, independent run bindings, exact events, incoming authors, Missing 3 evidence, retries, renames and completion cleanup must all pass the integrated path.
5. Actual Obsidian Sync contention and multi-device editing are untested for the replacement. File-update simulation is not Sync proof.
6. Automatic repair is not implemented. The available modify event does not establish deletion intent or trusted server revision ancestry. Unexplained missing/changed output becomes a preserved conflict; explicit checked restoration is implemented. Intentional deletion records prevent resurrection. Arbitrary old-device delete/undo remains ambiguous and must not be automatically undone.
7. Completed architecture requires actual platform/control/concurrent-view/migration/Sync acceptance, then the canonical build/full-test/reviewed-commit/strictly-newer immutable release, both installations with byte-identical data.json, a fresh verified Sync scan, real-client reload and bounded delivery smoke, and immutable smoke receipt.

No product deployment or receipt is authorized by desktop proof alone. Leave the job in Ready until its orchestrator can verify completed delivery.
