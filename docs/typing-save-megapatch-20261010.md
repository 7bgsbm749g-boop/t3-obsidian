# Typing, Stop, final-save, and reload repair

## Observed failures

The original large-note diagnosis was incomplete. Large generated tool HTML
was present in the native editor although its groups were closed. Each edit
also repeated response-boundary validation across that text. A small saved
note could therefore produce a much larger editor document from a retained
response. The word-count change reflected that display; it did not establish
that the word counter caused the delay.

A completed Stop took 14.213 seconds to reach the host acknowledgement in the
captured incident. The client allowed ten seconds. Stop transferred the large
frozen body and then read the full lease before accepting success. Eleven
successful acknowledgements survived while the client kept retrying.

One old final-save attempt had an unchanged response anchor and a 34-character
ordinary append. Its whole-document verification failed before a checked merge
could run. That old journal did not establish that the attempted write made no
disk change. A separate reply survived in a permanent final-writer grant after
a reload, while its old checkpoint still said running. These are separate
control and save states.

Evidence and preserved private bodies are outside Sync under
`/home/ubuntu/backups/send-to-t3-code/megapatch-diagnosis-20261010T002251Z`.
The exact event that removed another response's anchor remains unknown. The
patch does not recreate missing anchors automatically.

## Implementation

- Live Preview holds compact generated tool summaries. Opening a group loads
  its complete retained output through Obsidian's Markdown renderer. Source
  mode, saved notes, writer grants, and recovery proofs retain full canonical
  bytes. Narrow parsing excludes code and literal HTML. Summary edits,
  unmatched references, damaged incoming projections, and unload paths must
  not save an unbacked summary.
- Explicit sends and selection context read the full canonical text, including
  retained tool output and current response bodies. Selection insertion keeps
  the native display position. Partial tool summaries supply full protected
  context. The existing large-prompt limit therefore still applies.
- Typing maps generated ranges through native transactions and validates the
  smaller saved text and boundaries. Full validation remains on rebuild,
  recovery, and final materialization.
- The chooser reads current control state and small durable routing metadata.
  It has a total five-second check limit, cancellation, and Retry. Read-only
  connection reuse is scoped to credentials and permissions. Dispatch retains
  a fresh project, active-turn, approval, and input check. Cold hosts migrate
  historical route records in batches of eight after request replies, without
  loading their lease bodies again or delaying new registrations.
- Stop records a frozen body once and sends a hash reference with a stable
  operation ID. A small durable receipt acknowledges the host independently
  of full lease hydration. Retries stay single-flight, back off after failure,
  and cannot interrupt a newer turn. Local frozen bodies and their small index
  commit together in IndexedDB. The display freezes immediately, but previous
  recovery copies remain until that transaction completes. Legacy localStorage
  bodies migrate before the old list is cleared. Storage failure blocks an
  automated reload and retains the complete text.
- Final attempts record no-write, written-unverified, unknown, or verified
  outcomes. Automatic supersession requires provable no-write evidence. An
  uncertain legacy attempt requires an explicit current-note hash review and
  a durable host abort of the old intent. Old proof IDs remain fenced. The
  permanent writer actor and token remain unchanged.
- Each note has a final-save barrier. It drains an already captured native
  save and covers Obsidian's constructor-bound debounced save callback. It
  retains ordinary edits and releases queued autosaves after the final
  operation. Every current native pane joins the barrier. A pane opened during
  the operation joins immediately and invalidates the old pane snapshot.
  New panes use a full saved baseline to retain local and incoming ordinary
  edits. Partial pane preparation cancels every installed intent.
- Startup restores unfinished completion identities in bounded batches. A
  small transactional phase index supports discovery without repeatedly
  loading full response journals. Reload checks recovery durability, ordinary
  saved text, conflicts, exact release hashes, and final-save queues again
  after awaited work.
- An unprepared final grant can find a renamed note through its unique saved
  response anchor. The host confirms the new path before preparation or writing.
  Missing or duplicate anchors block the write. Prepared proof acknowledgements
  remain valid after later note changes or deletion.

## Verification

Run `npm run build` and `npm test`. Focused tests cover late aborted messages,
lost acknowledgements, uncertain writes, ordinary edits, multiple panes,
native save ordering, pending reloads, storage failures, damaged tool summaries,
literal examples, completed-turn controls, and repeated restart recovery.

An external replay uses the exact Obsidian 1.14.4 native-save function and the
production barrier. A controlled replay of the actual old conflicting response
keeps its full reply and the 34-character ordinary edit. It makes no automatic
abort or write for the uncertain attempt; checked review enables one new write.
These replays do not claim a repair of the user's live device record.

Native Linux measurements use eight trusted, spaced keystrokes in real
Obsidian 1.13.7 editors with the same 463,200-character synthetic tool body.
The baseline is committed version 2.36.14. The editor document changes from
463,380 characters to 587 characters while canonical output stays byte-identical.
Median transaction-guard time changes from 95.8 ms to 3.05 ms. Median time from
keydown to the next animation frame changes from 202.85 ms to 23.3 ms. The latter
is not a completed-paint measurement or a Windows result. Opening the tool group
loads 20 tool elements without enlarging the editable document. Native evidence
is under
`/home/ubuntu/backups/send-to-t3-code/megapatch-implementation-20261010T010000Z`.

The synthetic two-client Sync lab uses independent desktop state and official
Headless Sync to the T3 Sync Test Lab remote vault. Client B saves the final reply
while offline. Client A adopts the reply into its already-open editor after
Sync resumes, without reload. Both saved projections match disk, ordinary text
survives, and the acknowledged journal retires. The test does not cover desktop
core Sync or native iPhone/Android behavior. The lab removes its temporary note
and plugin and restores its settings; production QLO2 is preserved.

The immutable release and installed-client smoke receipts remain the authority
for deployment. A build, a unit test, a synced manifest, or a reload
acknowledgement alone does not prove the new plugin is loaded.

Windows native timing was attempted through the supported fleet CLI child. It
stopped before the child launched because the desktop computer-use connection
was unavailable. No Windows keys were sent. Prepared synthetic artifacts remain
outside the production vault. See `WINDOWS-NATIVE-RESULT.json` in the same
implementation evidence directory. No alternate GUI backend or permission
change was used.
