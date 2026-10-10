# Initial input placement

Initial questions and continuation prompts now use the same display placement
as steering. In Collapse mode, the input quote is the first item inside the
shared progress callout, from initial submission through streaming, recovery,
and completion. The current final answer remains below the completed fold.
In Keep and Remove modes, the input follows the active status header and stays
before the assistant transcript. Completed input quotes remain visible.

The renderer uses the existing initial-input record. It does not classify
prompts by words such as `continue`, convert primary inputs into steering,
change turn bindings, or move text in the user's saved note. Existing completed
Markdown is not rewritten. Exact prompt evidence, selection receipts, response
anchors, checked final saves, and Sync ownership remain unchanged.

Regression coverage checks the initial submission, each active or terminal
phase, formatted and raw final answers, unfinished input fences, input order
with later steering, final-answer placement, status discovery, and the existing
hosted input recovery across writer restarts.

Release verification must reload the real QLO2 client, verify the nested input
in Live Preview and Reading view, and check expanded and collapsed history.
Keep evidence outside the vault and preserve the user's current note and
settings. VPS desktop evidence does not establish native mobile coverage.

## Verified release 2.36.13

Source commit `0729477045aaa893f3ac629893188ef2bab2b809` passed the build,
1,181 TypeScript tests, and 13 Python tests. The supported immutable release
installed into both vaults, preserved installation settings, and completed the
fresh QLO2 Sync scan. The guarded native reload verified a new client instance
running 2.36.13.

A bounded real send and a second literal `continue` input each completed with
`INPUT_HISTORY_SMOKE_OK`. Both input quotes appeared inside the progress area
in Live Preview and Reading view. Closing the history hid the inputs and kept
both final answers visible. Saved bytes matched the visible editor and the
checked completion proofs. Each input retained its original primary message
identity; neither response acquired a steering record. Both durable bindings
reported `complete`, `finalSaved`, and `cleanupComplete`.

The temporary note was removed, the previously open note remained unchanged,
and the temporary desktop CLI setting was restored. The desktop CLI's missing
socket required native desktop-console setup of the test; screenshots and
application observations still came from the real reloaded QLO2 client.

Immutable smoke receipt:
`/home/ubuntu/backups/send-to-t3-code/releases/2.36.13/smoke-vps-qlo2-input-history.json`.
The receipt retains a checksummed ZIP of screenshots, application snapshots,
completion records, test logs, and cleanup evidence. This verification covers
the VPS desktop, not native iPhone, Android, or laptop rendering.
