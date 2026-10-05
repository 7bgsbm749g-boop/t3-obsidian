# T3 reply files: locations and import audit

The requested change keeps the dedicated vault folder as the general default,
adds image/document choices in settings, and adds relative choices for each
linked project folder at link/create time and under Linked folders. Unlinked
notes use general choices; descendants use the nearest non-root folder link.
The source note determines mirrored replies' destinations. New sends retain
their resolved choices instead of consulting changing settings at completion.

## Observed missed attachments

Read-only inspection of QLO2's completed response records and actual settled
notes found these concrete examples (synthetic deliberately-missing test
attachments were excluded):

| Settled note | File left as an unusable server path | Evidence |
| --- | --- | --- |
| `Projects/Side/T3 CODE x OBSIDIAN/Jobs/Settled/2.30.4-6 tool calls at the bottom of the agent stream.md` | `/home/ubuntu/backups/send-to-t3-code/releases/2.30.6/smoke-vps-qlo2-evidence.zip` | Completed binding `4b055e1b-0716-5a4e-9692-a171c0a08015` retains an import failure; the settled note still has the original link. |
| `Projects/Side/T3 CODE x OBSIDIAN/Jobs/Settled/2.30.2-3 Collapsible Intermediate Steps and Run Timer.md` | `/home/ubuntu/backups/send-to-t3-code/releases/2.30.3/smoke-vps-qlo2-evidence.zip` | Completed binding `10163249-4d93-593e-9ea7-f1a9aec8e698` retains an import failure; the settled note still has the original link. |
| `Projects/Side/T3 CODE x OBSIDIAN/Jobs/Settled/2.12.21 Clean up cancelled workflow edit requests.md` | `/home/ubuntu/projects/send-to-t3-code/release/send-to-t3-code-2.12.21.zip` | Direct settled-note inspection confirms the original server-path link. This older example has no matched recent retained failure record. |

A further recent completed response in
`Projects/Side/Other obsidian plugging/Empty Child Plugin/Move Folder Contents to Parent and Delete Empty Folder.md`
has the same failure for
`/home/ubuntu/projects/Empty Child Plugin/releases/1.0.0/empty-child-1.0.0.zip`
(binding `6eb79d93-2e54-55cc-ba23-25c9f52f0ebb`). This note was not classified as
settled. The audited recent settled misses were ZIPs; this inspection does not
establish a separate image-specific failure.

The old importer first requested T3's media-preview URL, which rejects ZIPs,
then tried its text-only project reader. It also discarded the underlying
failure reason. It ignored source links with line numbers, did not recognize
sandbox paths, and did not map absolute vault paths to existing vault files.
Repeated references downloaded again even when their deterministic file was
already present. Independent mirrors used different binding directories.

## Import behavior

Local T3 access now includes a bounded regular-file reader. It is available
only when the writer accesses this computer's verified local T3 environment;
remote connections never receive the capability. It retains binary bytes and
empty documents. Remote preview downloads and recognized text readers remain
supported; unsupported remote binary files remain original links with an
inspectable failure. Binary bytes cannot be re-encoded as UTF-8.

Files are reused by source path within a stable thread/message directory and
configured scope. Concurrent imports share the in-flight write, and failed
attempts can retry. Folder creation happens after a successful bounded read.
Existing files are never overwritten. Completed historical notes were inspected
without rewriting them; reattaching a response can recover its files in a new
destination.

## Verification

Regression coverage includes routing boundaries, nested links, validation,
synced preference merging, folder mutation replication, link-dialog choices,
failed-save rollback, mirrored/concurrent imports, retry after failure, empty
documents, exact binary reads, size limits, absolute vault links, sandbox/line
references, and remote binary rejection. The reviewed build passed with all
818 TypeScript tests and 11 Python tests. The immutable release, fresh official
Sync scan, and real QLO2 smoke are required before delivery is considered
complete. Native mobile rendering is not covered by the VPS smoke.
