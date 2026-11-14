# Regression audit: note workflow

The audit covered the project's 285 earlier ordinary conversations and the
current affected tests. Detailed conversation excerpts stay in private external
evidence. A historical statement that tests passed is not proof that a current
regression cannot occur.

## Findings and changes

| Area | Gap in prior checks | Current check |
| --- | --- | --- |
| Ask naming | Direct commands had changed while the dynamic palette row kept the old name | Palette suggestions cover selected and unselected states |
| Selection placement | “Before the next paragraph” passed when the reply moved past the rest of the selected paragraph | Cursor tests require placement before the remaining line and rebase after the source frame is finalized |
| Smart Send | Several tests required sending fragments from edited paragraphs and agent replies | Those obsolete expectations are replaced by fresh-block and personal-reference cases; explicit selections remain covered |
| Retained history | Tests covered a newly toggled node, not a restored open node with native classes | Open-history loading works with extra native classes; errors have a retry action |
| Completion glow | Server read-state tests did not cover clicking an already active note | Explicit-click coverage does not need another timer tick |
| Shared projects | A flat catalog had no repository identity | Grouping tests distinguish repository identity, machine identity, and unrelated projects with equal names |
| Ask Queue | No queue contract existed | Snapshot, order, validation, and bounded combined-prompt checks |

## What remains useful

Keep tests for checked-save conflicts, user edits, Stop, selection ambiguity,
duplicate text, delayed delivery, reload recovery, imports, platform boundaries,
and device-local state. A later regression does not make these tests useless;
it identifies a state they did not exercise. Do not delete safety coverage merely
to reduce a test count or because an old release passed it.

Source-level tests do not establish native editor layout. Native checks use an
isolated unsynced vault and the same product methods. Screenshots identify that
fixture explicitly. Desktop checks do not establish phone behavior. The native
lab accepts `--runtime-root` to keep execution scratch local while retaining
completed reports and captures in the external evidence directory.
