# Unread completion glow

Successful, verified responses give their explorer note label a soft glow in
the current Obsidian accent colour. Collapsed ancestor folders alternate the
glow between their chevron and name. Expanding a folder leaves the signal on
its descendants. Folder Notes uses the existing installed-plugin adapter,
including inside-folder and parent-folder storage, configured names, supported
extensions, exclusions and detached folders. A hidden folder note therefore
lights its folder label, including when that folder is expanded.
Completion does not add a green dot or a persistent status badge. The glow
is its only explorer completion signal.

A focused, visible Markdown note acknowledges its completions after at least
750 ms. Background tabs, a hidden document, an unfocused window and modal
dialogs do not acknowledge them. T3's server `lastVisitedAt` determines whether
each exact completed run is unread. Reading a result in T3 clears its Obsidian
highlight; reading it in Obsidian sends T3's `thread.visit` command. Mirrored
destinations and other clients then use the same server state.

Visits carry the bound run's canonical completion time, never the device clock
or a newer thread timestamp. Reading an older imported result therefore cannot
mark a newer result read. Several results in one note share one visit per thread,
through the newest completion actually shown in that note. The plugin confirms
the resulting server watermark before clearing the highlight. Lost visit
acknowledgements retain the same command ID for a bounded retry. An explicit T3
mark-unread remains unread while the same note stays focused; switching notes,
refocusing, or displaying a new completion permits another acknowledgement.

The plugin shares one credential and one shell metadata read per machine every
15 seconds while its explorer projection refreshes. Refocusing requests a fresh
read. No transcript or unrelated thread metadata is retained by this component.
Connection failures keep the last confirmed server state and never create a
local read flag. Servers without `lastVisitedAt` cannot supply this feature;
ordinary activity indicators and response delivery continue to work.

Device-local receipts retain only note/run identity across reloads, follow file
and folder renames, and retain deletion tombstones. The retired `viewed` flag is
ignored. Old receipts recover their connection only from an exact saved response
binding. A missing completion time can be filled only when T3's latest completed
run has that same run ID; a newer run cannot be substituted. No note or shared
settings writes drive the animation.

Already attached runs keep their live completion watch after their tab closes.
Verified completion releases that watch; the final Markdown save still waits
for an open editor and the existing Sync gate. The explorer keeps completion
metadata after that save. A device must have attached the run to observe it;
this feature does not discover historical runs in unopened notes.

Reduced motion keeps a static accent glow. Forced colours use the system link
colour and an underline. Running-response shine and linked-folder badges keep
their existing functions.

Verification: `npm run build`, `npm test`, then the supported QLO2 release,
fresh Sync scan and real client reload. File/folder/folder-note fixtures and
view acknowledgement checks belong in a separate test vault. QLO2 release
checks create no test content. Keep evidence outside every vault and record
an immutable smoke receipt. Desktop rendering does not establish native iOS
or Android coverage.
