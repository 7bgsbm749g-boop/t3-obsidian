# Questions, note panels, and accepted-send recovery

The three investigations from 2026-10-12 found the same repeated-read path.
A question refresh downloaded conversation history and up to 40 omitted tool
outputs. Submit repeated that read twice before dispatch and once afterward.
The public-endpoint sample took 1.71 seconds for the full reader and 0.44 seconds
for the existing control reader. These were individual samples, not device-wide
latency guarantees. The reports also found response-only question controls
missing from saved anchors, draft writes on every keystroke, and full Markdown
code parsing after old dismissals. Windows logs showed accepted sends followed
by response-boundary errors and an incorrect second “not started” entry.

Both question answers and Ask/Send now use `NoteTabPanel`: Obsidian controls in
an overlay attached to the captured Markdown view. It does not create a global
backdrop. It closes on Escape within the panel or a tab change, restores focus
without scrolling, and limits height for a small window or virtual keyboard.
The native modal remains the fallback when no note view exists. The custom
question-field glow is removed.

Question refreshes use `controlOnly=true`. One in-flight read per environment
and thread serves all concurrent targets, including targets added during the
request. Submit uses one fresh preflight and one post-dispatch control read.
Feedback and duplicate-click locking happen before asynchronous work. Commands
are persisted before dispatch, retain exact IDs and bytes on uncertainty, and
close the panel only after explicit resolution. Explicit runtime request state
can resolve an old question whose timeline control is outside the bounded
window; an absent control alone never proves resolution. Reads have an eight
second deadline, ignore stale sequences, and stop when the controller disposes.

Question widgets, open forms, and pending saved commands retain monitored
targets independently of note disk contents. Existing direct response feeds
pass only question activities to the controller. Background control checks do
not wait for note filesystem work. Recent live state coalesces background
checks; submission always asks for a fresh authoritative check. Draft writes
wait for 250 milliseconds of quiet and flush before submission or lifecycle
exit. Live status updates do not force a draft save.

Dismissal decorations update only when the dismissed set changes. Ordinary
typing maps existing hidden ranges; structural changes recheck sections and
code fences. Notes without actual question-start markers skip the Markdown
code parser. Saved cleanup caches only a bounded set of hashes and keeps live
response hashes intact.

Accepted sends keep their registered display and note/thread association after
a local confirmation failure. Exact acceptance evidence governs this branch;
an unknown dispatch result still uses terminal failure cleanup. The full-note
send no longer shadows the prepared request in its outer handler. No recovery
path dispatches another prompt. Existing connection recovery and permission
checks remain in force.

Regression checks cover shared reads, immediate feedback, byte-identical retry,
another-device resolution, uncertain and failed storage, display-only targets,
draft coalescing, stale events, large-note edits, tab ownership, Escape, captured
routing, and both accepted chat and note failures. Release verification must
also exercise the installed production bundle in a real QLO2 client, including
one bounded real question delivery. Record its release receipt separately.

The plugin changes do not remove provider/model latency after answer acceptance
or prove the cause of an earlier connection timeout. Memory pressure and the
Obsidian filesystem queue are separate service concerns. Desktop checks and
synthetic small-window checks do not prove native Windows or phone rendering;
report those coverage limits with the release evidence.
