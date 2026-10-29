# Whole-plugin review corrections

The review of 2.45.55 identified seven faults in runtime behavior and validation.

Event subscriptions now compare source text after applying saved response
provenance. Both the previous and current note use the current provenance, so
arrival of a generated reply does not become a user edit. A receiver holds a
replacement of a known response anchor until its provenance arrives, including
when the response binding itself has not arrived. Ordinary edits around a live
anchor and deletion of an empty anchor remain observable. Action effects use
the same projection to prevent their own saves from causing another event.

The project-file adapter now has one stable prefix guard. Unload releases its
active bridge handler; subsequent loads reuse the guard. The permanent wrapper
is created in a separate lexical scope so it cannot retain the first bridge.
An old virtual save remains blocked after unload, and physical vault operations
continue through the original adapter methods.

Frozen response storage exposes a metadata-only index and selective body reads.
The native manager loads a body only for an open matching response anchor, and
releases it when the anchor or pane is gone, its note is deleted, final adoption
finishes, or the manager unloads. A stale pane cannot reload a deleted note.
Rename updates the durable index without loading closed historical bodies.
Immutable body blobs and integrity checks remain available for recovery.

Final-response verification closes each temporary access on success, error,
timeout, suspension, and late factory completion. Cleanup does not delay display
of an already verified reply while the local CLI revokes its session.

New local automatic-title sends persist a title-generating launch choice before
dispatch. Retries reuse the same launch, model defaults, and message identities.
Previously prepared requests retain their original command path; named notes
and existing-thread sends retain their established behavior.

The affected-test graph includes literal esbuild entry points and their
transitive dependencies. Test selection and cached success therefore cover the
source bundled by a dedicated test. The build cache also follows the builder's
file reads, including `THIRD_PARTY_NOTICES.md` embedded in the bundle banner.

Regression coverage includes delayed provenance and bindings, independent user
edits, action feedback, stable adapter reloads, selective recovery, missing and
corrupt historical bodies, session lifetime failures, lost launch
acknowledgements, entry-point selection, and notice-only cache invalidation.
The private `--review-corrections` native lab exercises production modules in a
real Obsidian editor, makes one bounded local T3 delivery with an automatic
title, and checks response saving, event filtering, session closure, frozen
recovery, and bridge reloads. Its cleanup command deletes its synthetic thread
through T3's native dispatch and its notes through Obsidian's vault API.

Task evidence is kept under the source worktree's ignored
`evidence/implement-review-corrections-20261030/` directory. The native lab is
unsynced; delayed receiver ordering is covered by automated regressions. QLO2
release checks create no test notes. No native iPhone or Android behavior is
established by these desktop checks.
