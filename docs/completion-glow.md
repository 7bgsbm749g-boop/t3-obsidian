# Unread completion glow

Successful, verified responses give their explorer note label a soft glow in
the current Obsidian accent colour. Collapsed ancestor folders alternate the
glow between their chevron and name. Expanding a folder leaves the signal on
its descendants. Folder Notes uses the existing installed-plugin adapter,
including inside-folder and parent-folder storage, configured names, supported
extensions, exclusions and detached folders. A hidden folder note therefore
lights its folder label, including when that folder is expanded.

A focused, visible Markdown note acknowledges its completions after at least
750 ms. Background tabs, a hidden document, an unfocused window and modal
dialogs do not acknowledge them. Each new exact run has its own receipt. Final
save revisions do not relight an acknowledged run. Receipts stay in Obsidian's
device-local storage across reloads, follow file and folder renames, and retain
deletion tombstones. Viewing on one device does not acknowledge another device.
No note or shared settings writes drive the animation.

Already attached runs keep their live completion watch after their tab closes.
Verified completion releases that watch; the final Markdown save still waits
for an open editor and the existing Sync gate. The explorer keeps completion
metadata after that save. A device must have attached the run to observe it;
this feature does not discover historical runs in unopened notes.

Reduced motion keeps a static accent glow. Forced colours use the system link
colour and an underline. Running-response shine and linked-folder badges keep
their existing functions.

Verification: `npm run build`, `npm test`, then the supported QLO2 release,
fresh Sync scan, real client reload, visible file/folder/folder-note checks,
view acknowledgement and an immutable smoke receipt. Desktop rendering does
not establish native iOS or Android coverage.
