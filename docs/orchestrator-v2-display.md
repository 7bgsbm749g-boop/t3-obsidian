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

The picker now checks immutable small requests before reading unrelated leases.
When a relevant lease exceeds the preview limit, `response-import-info` uses the
existing authenticated host command mailbox to return a bounded, read-only
projection: the source request, exact bindings and turn records, terminal state,
run IDs and input IDs needed to detect duplicate imports. It excludes response
bodies, save documents, boundary prose and steering text. The host verifies the
binding and vault identities and limits the reply to 512,000 UTF-8 bytes. An
unsupported or failed host read still fails rather than inventing an association.

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
