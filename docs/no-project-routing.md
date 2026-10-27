# Threads without a vault project

New unlinked sends use T3's native `projects.ensureScratch` operation. The
returned project ID remains part of normal thread, response, history, import,
subscription and retry identities. The plugin does not register a project at
the vault root, use a null project ID, or move old conversations.

A remembered thread still wins over a linked folder. The nearest explicit
folder link wins for a new conversation. Otherwise the destination is
**No project**, with an explicit machine option available in the chooser.
**New project** remains an explicit choice for an unlinked folder. Empty notes
and cancelled choosers dispatch no thread. Missing linked projects remain
errors; they do not silently fall back to another destination.

`vaultHost` stores the machine and synced vault path needed by subscriptions,
followed threads and staged edits. Existing root links are read as host
locations in place. They no longer provide a project destination. New setup
verifies the vault identity and saves its location without creating a project.
New local response bindings retain a real vault location rather than the
thread's scratch workspace. Existing response bindings retain their original
locations and IDs.

The Wait for other threads setting and its agent instructions are removed.
Old send contexts remain readable; their retired wait field is ignored. The
plugin neither waits for unrelated No project conversations nor migrates old
notes or histories.

File passthrough is implemented separately. The bridge receives authenticated
environment IDs from `main.ts`; folder links are not an authority for arbitrary
filesystem paths. The file-access owner validates the current project/thread
workspace and preserves physical vault and wiki-link precedence.

Verification must include a bounded real No project delivery in a separate
test vault, actual thread workspace metadata, preserved old conversations,
and the absence of automatic vault-root project registration. QLO2 checks
create no fixtures. Native phone behavior requires separate device evidence.
