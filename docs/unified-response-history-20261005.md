# Unified response history — QLO2 2.31.31

Collapse presentation now uses one native history callout per response. Its top header controls intermediate prose, steering, structured question answers, and earlier completed turns in chronological order. The latest completed answer stays below the fold. Sender labels remain You, User, or Agent with the existing provenance rules. Keep and Remove retain their existing presentation semantics.

The display removes only the recognized generated terminal Obsidian delivery footer and its associated reply instruction. Canonical prompts, input receipts, and recovery checkpoints keep the exact original bytes. This does not introduce a hidden T3 system/developer channel. Literal code examples, malformed or nonterminal footers, and ordinary user content remain visible. Previously saved completed Markdown is not rewritten.

## Validation

Build and the full suite passed: 766 TypeScript tests and 11 Python tests. Coverage includes one fold, input ordering, frozen prefixes of growing answers, final-answer placement, stable fold identity, sender labels, Markdown boundaries, exact footer recognition, and the full-note trailing-newline boundary.

The immutable 2.31.31 release installed into both supported vaults, preserved device-local settings, and completed the fresh official Sync scan. On the real VPS QLO2 client, the guarded reload command invoked the native app reload with verified runtime hashes; the client subsequently reported loadedVersion 2.31.31 and a new instance ID. A bounded synthetic send and steering flow verified clean User input within the shared fold, surrounding assistant paragraphs, and recovery after a second native reload. Evidence also records completed expanded/collapsed history, visible final answer, and unaffected following note content.

Release receipt: `/home/ubuntu/backups/send-to-t3-code/releases/2.31.31/deployment.json`.

Desktop smoke receipt: `/home/ubuntu/backups/send-to-t3-code/releases/2.31.31/smoke-vps-qlo2.json`.

Evidence is retained outside the vault under `/home/ubuntu/backups/send-to-t3-code/unified-history-20261005` and copied into the immutable smoke evidence archive. Temporary synthetic notes were removed after completion. The original open note, clipboard, settings, and unrelated windows were preserved.

## Limits and superseded attempt

This verifies native VPS desktop Live Preview and Reading view, not native iPhone/Android or laptop rendering. The auxiliary laptop reload request was pending; desktop delivery is established by the actual VPS client check.

The first immutable candidate, 2.31.30, exposed a generated full-note prompt newline boundary that left the reply instruction visible. It remains awaiting live smoke and was superseded without changing its archived bytes. The regression fix shipped as the strictly newer 2.31.31 release.
