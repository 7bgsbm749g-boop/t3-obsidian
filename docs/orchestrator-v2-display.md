# Orchestrator v2 display and import follow-up

This work follows the completed 2.36.4 memory release and preserves its source
commit `cf98bc1`. The user explicitly excluded changes to steering, selected-text
removal, typed-text preservation, editor/save projection guards, cursor mapping,
Sync handling and existing orphan anchors. Those investigations are read-only.

## Display changes

The v2 adapter already receives public `reasoning` turn items, but the response
renderer previously selected only assistant prose. The note now shows those
public summaries in native, default-closed Thought callouts. Plans use native
Plan callouts. They are ordered with retained tools inside the existing progress
fold, never substituted for the final answer or used as completion evidence.
The existing intermediate-output policy still removes them from a final-only
completion. No hidden provider state is requested.

Compaction turn items previously became generic tools labelled `Running
compaction`. They now show `Compacting context` or `Context compacted` with the
inward-arrow icon (`minimize-2`), without a separator line. Failure and stop
labels remain distinct. The same item ID replaces its previous row. Compaction,
reasoning, plans and tool completion cannot complete a parent app run.

Native web searches now use `Searching web`, or the query when structured input
provides one. T3 thread reads have a thread label, short source ID and thread
icon. Other existing browser, device, pull-request, command, file and generic
tool rows remain visible. Notifications and errors no longer disappear or look
like generic running tools. Approval and question controls retain their exact
runtime capabilities; background tasks retain their own lifecycle.

The live tool summary used `<strong>` while completed summaries used `<span>`.
Both now use ordinary text, with a style rule for previously generated live
summaries. This is a presentation change; tool state and controls are unchanged.

## Import failure and compatibility fix

The screenshot names lease `ca2f7e4c-c244-58bb-8cb3-5252ee6054c5`, which was
1,740,700 bytes during inspection. It belongs to a different source thread.
The picker scanned all retained leases before listing the selected source, and
T3's `projects.readFile` returned a truncated one-MiB preview. Parsing or trusting
that preview would lose exact history evidence. T3's preview resource API also
rejects JSON, so it cannot serve as a complete lease download.

The first fix checked immutable small requests before reading unrelated leases.
It still made hundreds of sequential cross-device reads. An oversized relevant
lease also exposed a routing bug: an active service on the laptop could receive
an import-evidence command intended for the selected VPS response host.

The picker now uses `response-import-records` to filter requests on that exact
host. It returns compact pages of at most 64 records and 500,000 payload bytes.
Local request files filter unrelated leases; missing legacy requests fall back
to their authoritative local lease. Completed records remain available without
depending on the active response catalog. Import reads require both the selected
environment and workspace to match before using a local desktop service;
otherwise they use that selected host's authenticated command mailbox. The
single-binding `response-import-info` read follows the same route.

Run-list reads request the native v2 compact bounded snapshot and conversation
history pages. They preserve exact input/run IDs and legacy binding recovery,
without fetching omitted tool outputs or source-thread titles. After selection,
imported-response reads also use the compact bounded snapshot and retain only
conversation messages and that exact run's display items. They hydrate omitted
tool output only for that run, then use the existing full rendering path. This
avoids the duplicate full snapshot that exceeded the unchanged four-MB response
limit while importing the table run. Ordinary streaming reads remain unchanged.
Compact host evidence
includes the source request, bindings, turn records, terminal state and input
IDs, while excluding response bodies, save documents and boundary prose. An
unsupported or failed host read fails rather than inventing an association.

This change does not restore a completed import whose note block was removed.
The existing duplicate rule and failures caused by literal structural tags
remain separate proposals, as requested by the user.

Normal note reads, writes, save acknowledgements, ownership and Sync handling
are unchanged. Existing v1 saved bindings can still recover migrated completed
runs; a missing exact binding still makes a run unavailable. Repeated imports
retain their existing deterministic binding ID.

## HTML diagnosis and proposed patch

The original compatibility thread (`d072fae6-0c59-48be-8ddc-5385cf6b8df4`) contains
an actual completed `t3-code.html_render` result with `htmlRender.attachmentId`,
`title` and `height`. The HTML is a separate T3 attachment. The reply asset pass
only rewrites links in assistant Markdown; the tool record is escaped text in a
dropdown. Thus the interactive HTML page is not seamlessly shown in the editor.
Raw assistant HTML remains literal Markdown.

Proposed implementation:

1. Recognize only a verified completed `html_render` result, keyed by the exact
   turn-item ID and revision. Keep preview results and failed renders distinct.
2. Resolve its attachment through T3's attachment resource API. Download bounded
   bytes into a content-addressed artifact cache with title and source provenance;
   do not store expiring signed URLs in note text.
3. Provide a stable native image embed for the rendered preview and a link to the
   full HTML. Use an isolated HTML viewer for interaction, without access to the
   Obsidian application or note APIs. A future native editor embed can host that
   viewer without changing ordinary document offsets or the save projection.
4. Verify theme, height, loading/error state, offline reopening and completed
   rendering in both Live Preview and Reading mode. Preserve the existing HTML
   escaping boundary and the checked note-edit protocol.

This is a concrete proposal, not an HTML embedding implementation in this run.

## Read-only editor findings

Three timer-triggered stream attachments failed with `Invalid initial response
input`: v2 scheduled messages have opaque IDs, while hosted initial-input
validation accepts UUIDs. Preparation inserted blank response anchors before
validation failed. Those anchors have no coordinated response record. Their
comments disappear in Reading mode; Live Preview hides the comments while
leaving editable rows. Text typed there then becomes saved ordinary text. The
three orphan anchors and that user text were not removed or repaired.

Proposed recovery must validate before inserting an anchor, accept verified
opaque message IDs at the correct boundary, and resolve existing orphans from
recorded provenance while preserving all typed content. It needs a separate
review of editor, save and Sync behavior before implementation.

The preceding response retained seven confirmed steering selections, all marked
`selectionApplied`. That flag is set after a note update even when the exact
selection range was not found. It therefore does not prove removal. The native
completion draft also uses the stored anchor against saved text. Investigate the
exact displayed/saved selection mapping and delayed consumption before changing
it; never use unrestricted text matching to remove a selection.

The saved note initially measured 186,208 bytes, with three collapsed tool HTML
lines of 90,614, 51,205 and 40,094 characters. The unchanged 2.36.4 typing path
rebuilds saved/display projections and parses Markdown ranges on a changed whole
document. A read-only reproduction measured 297.4, 234.9 and 307.2 ms per edit
before editor rendering. This is not a native keystroke measurement on the
user's device.

The 2.36.4 report measured 97.6% fewer allocations in controlled recovery
maintenance, but the native whole-renderer allocation total did not fall. That
release did not change the typing filter. The source result indicates a separate
editing cost; the user's client version and actual typing after updating must be
checked before making a device-level claim. No typing optimization is implemented
here. Detailed measurements and the gap screenshots are retained outside the
vault in the completion-watch evidence.

## Native v2 agent attribution

V2 MCP messages already contain canonical `createdBy: agent` and
`senderThreadId`. The older renderer recognized only fleet context records;
the live event and paged-history adapters also dropped the native sender fields.
These fields now survive both paths. Exact source IDs resolve against shell
metadata in the same authenticated environment, including returned archived
threads. A bounded 256-entry cache limits lookups; missing or unavailable source
metadata shows an agent label with its short ID. Human inputs stay neutral, and
validated old fleet records still work. Titles use the existing escaped quote
heading. No steering dispatch, selection consumption or execution binding changes.

## Unexpected interruption: read-only findings

The exact interrupt command `498dd4ed-c8e2-5a57-9a1c-a9013d521f72` was accepted
at 17:40:18.467 UTC. It is the plugin's deterministic interrupt ID for response
`fde3fe56-7fe2-4587-bf9d-6f8d45f0633f`, not the GUI-release notification command.
The private stop file was requested at 17:40:15.041 UTC. The other thread's
notification had entered `queue_after_active` at 17:37:40.361 UTC; its event
record contains no interrupt. T3's generic “Run interrupted by user” text does
not identify a physical Stop-button action.

`failRequest` calls Stop on an existing attached response after a steering or
continuation failure, including failure before dispatch. That can interrupt
unrelated ongoing execution. The preceding accepted input copied the response's
literal end marker into its text. Rendering that marker in the user quote
reproduces `Missing, duplicate or reversed response boundaries`. The later SSH
log read from the laptop identifies the failed stage at 17:40:14.300 UTC:
`response-registration`, delivery `not-started`, with “Wait for a running
response before steering. If it finished or paused, ask again after it finishes.”
This failure precedes the recorded Stop request and confirms the failed-steer
cleanup path. It does not establish why that response was unavailable to the
laptop; the copied marker is still a separate reproduction, not a proven cause
of that check. Its two later “acidentally wrote…” attempts remain saved in the
note and have no corresponding T3 input event. VPS failure logs have no matching failure.
No marker, user text, steering cleanup or projection guard was changed.

A separately reviewed correction should scope cleanup to the failed new send,
retain an existing active response, preserve accepted/uncertain delivery evidence,
and render literal control comments without interpreting them as boundaries.
The originating-device log is retained outside the vault. Tests for confirmed,
rejected and uncertain steers still need a separate authorized implementation.

## Read-only failure logs over SSH

`send-failure-log` returns the existing device-local log through the private
command mailbox. It includes the loaded instance/version, device ID, and at most
64 failures. Optional `--since` filters by UTC time. Export whitelists metadata
and rechecks error redaction; prompts, typed text, credentials and arbitrary
stored fields are excluded. It does not clear the log, save a note, dispatch a
prompt or reload a client. Use a new request UUID for a fresh log; an exact replay
returns the original snapshot.

From the VPS, the CLI reuses the existing Windows private SSH mailbox transport:

```bash
python3 scripts/obsidian-command.py \
  --vault 'C:\Users\jacks\Documents\QLO2' --ssh-host fleet-laptop \
  --request-id REQUEST_UUID send-failure-log --since 2026-10-09T17:39:00Z
```

This narrow SSH option cannot send notes or request reloads. The remote vault
must be open with the updated plugin loaded. A pending result means the running
client has not answered; an on-disk manifest is not loaded-version evidence.

## Plan recording follow-up

The supplied 40.7-second recording exposes two Markdown display failures. A plan
following ordinary quoted prose merges into the same nested blockquote, so its
callout header is literal text. Generated display-only block separators now keep
Thought, Plan and Notice callouts separate from neighbouring prose. They are not
response anchors and do not change ownership, save filtering or cursor mapping.
A Markdown AST test verifies that neighbouring commentary stays outside Plan.

A native QLO2 check also showed that clicking Plan was captured by the outer
progress click handler. That handler now accepts only its own direct title;
nested callouts keep their native controls and cannot change the outer choice.

Windows SSH output contains CRLF and lone CR characters. The tool HTML encoder
previously replaced only LF, leaving physical CR characters in a quoted HTML
line. Markdown then split that line, showing `&#10;` and tool output outside the
closed row. The renderer now encodes CRLF, CR and LF as one visible newline each.
Canonical tool output retains its original bytes; no editor/save path changes.

The later stream failure is separately recorded: response `037a0cac` is paused
with “Response markers removed or malformed” at 18:01:25 UTC, while app run 10
continues. The later new queued app run 11 was cancelled at 18:05:43 UTC. These
states must not be described as another interruption of the active app run.
Its note and response markers remain untouched.

## Windows command bridge correction

The private mailbox opener and response journal both checked a relative parent
path using only `../`. Windows returns `..\`, so the laptop's outside-vault
mailbox was falsely classified as inside QLO2 and rejected before its route was
created. A direct reproduction with `node:path.win32` confirms that result.
The laptop had 2.36.6 on disk, no storage route and no private vault directory.

Release 2.36.7 shares a corrected native path-containment check. It accepts
outside-vault Windows paths, including another drive and another UNC share,
while still rejecting the vault itself and descendants. It changes no migration
algorithm, note save, typing, steering delivery, ownership or Sync behavior.
The SSH helper reports `bootstrapRequired` without writing a command into the
synced vault when that private route is absent. An affected running client must
load the fixed release once before its bridge can serve future requests.

The user loaded 2.36.7 on the laptop. Its private mailbox then answered status
and read-only failure-log requests. A guarded SSH reload acknowledged the exact
immutable runtime hashes and changed instance `2987145b-70ed-4cb6-9baa-9a612b278780`
to `33911afd-11b6-4848-b3a7-50e89b89fc37`, still reporting loaded version 2.36.7.
The Windows private writer lock exists and all three runtime files match the
immutable release. The existing saved-editor and release-hash guards remain.

## Live verification of 2.36.7

Build and the complete suite passed: 1,164 TypeScript tests and 13 Python tests.
Reviewed source commit `56380f1` and version commit `6db4187` preserve the 2.36.4
memory work. The supported release command installed development and QLO2,
preserved both installations' settings, and required a fresh Fully synced scan.

The real QLO2 VPS client passed a guarded native reload from 2.36.6 to 2.36.7,
changing its loaded instance to `30a5bc8e-3664-4cb9-9320-b11f1b1b4dc9`. Native
screenshots verify public Thought and Plan in native Reading view and Live
Preview across the follow-up releases. The 2.36.7 checks also verify query labels,
ordinary tool weight, compaction icons and labels without separators,
independently folded Plan, and contained Windows CRLF/CR output in Live Preview.

The actual initial migration response was imported through the native picker:
thread `d072fae6-0c59-48be-8ddc-5385cf6b8df4`, run ordinal 1, input
`390a1b1b-5eab-4f90-a933-a4c23bd09bd2`. Binding `894f99b8-14b7-5052-8f38-b994e7c78e32`
saved, removed its active/proof anchors, and reported checked completion and
two device acknowledgements. The source remained at 10 runs and 1,037 items;
no prompt was sent. The imported result remained visible after the 2.36.7 reload.

A real canonical MCP agent message passed the plugin's authenticated sender
metadata lookup and rendered as `Agent · Orchestrator v2 upgrade` in the native
editor. No replacement message or sender context was sent. Four owned test notes
were backed up and removed; the original VPS note and Live Preview mode were
restored. The destination upgrade note, orphan anchors and user writing were
not edited. Its malformed response remains paused; registration stays enabled.

Durable artifacts are under
`/home/ubuntu/backups/send-to-t3-code/orchestrator-display-2.36.5/` (the directory
name predates the later releases). The combined immutable release evidence is
`/home/ubuntu/backups/send-to-t3-code/releases/2.36.7/smoke-vps-qlo2-evidence.json`.
Earlier 2.36.5 and 2.36.6 packages remain immutable; this verification covers
their changes in the final 2.36.7 release.
