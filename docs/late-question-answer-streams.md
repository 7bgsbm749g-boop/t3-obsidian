# Questions stay with their original response

A local completed turn no longer retires its response while an async question
is unresolved. The final text stays visible and the shared response header
shows **Waiting for answer** without a loading animation. Questions use compact
rows in the response instead of an independent quoted panel. Canonical answer
resolution hides the whole row in Live Preview and Reading view; a compact
submitted-answer disclosure remains in chronological response history. Closing
the form leaves a question pending. Dismiss resolves an async question without
sending an answer.

Turn completion and response retirement are separate decisions. A verified
terminal update retains a device-local recovery copy, including its exact turn
bindings, pending questions, received prose and input boundaries. The original
note anchor and synced routing record stay intact while questions wait. A
closed note retains its question watch. A new device can read T3 from the same
anchor; a reload can restore the local checkpoint without certifying a final
note write. A cached final from an older plugin that still contains question
controls also remains attached.

The existing exact async-answer follower now applies to local responses. It
retains the original response identity, earlier final text and submitted input
while following the answer's canonical turn. An accepted resolution that arrives
before its answer message keeps waiting for the exact binding. Another latest
turn is never sufficient. Final-save guards reject an update superseded by a
question or answer at the write boundary. Only a verified terminal update with
no pending questions can replace the original anchor with completed Markdown.

Late-answer recovery persists the exact answer intent before dispatch. It
registers the existing original response instead of appending a second stream.
The intent remains until that original reader observes the exact answer turn,
including after lost acknowledgements or a restart between registration and
first projection. Native blocking answers and dismissals do not create these
intents. Existing continuations created by older releases remain supported.

For an older response already saved as Markdown, canonical source-turn ownership
must identify one original binding. Its stored response body must match exactly
one complete, unfenced region in the destination. A checked note update replaces
only that region with the original anchor and restores its source prose. Edited,
copied or missing text is preserved; a notice explains the failed reattachment.
Generated question cleanup waits for the recovery intent so it cannot remove
that exact saved-text evidence prematurely. Resolved cleanup removes only valid
generated sections outside live responses and preserves literal code examples.

The native validation fixture is `validation/unified-questions-lab.ts`, built
with `node scripts/build-native-response-lab.mjs EVIDENCE_DIRECTORY --questions`.
Supply `TEST-CONFIG.json` with the current source thread ID. It runs one bounded
real T3 async question, waits for source completion, restarts the local response
manager, and waits for a native Answer/Submit action. It records rendered and
saved results and deletes its exact temporary thread and notes. The fixture
uses an isolated unsynced vault. It does not establish real Sync races, desktop
core Sync engine behavior or native iPhone/Android behavior.
