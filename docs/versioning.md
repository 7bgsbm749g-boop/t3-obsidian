# Alpha version policy

The project remains in **alpha**, with plain **`0.0.BUILD`** versions in the
Obsidian manifest, package files, compatibility map, archive, and matching Git tag.
Each newly packaged release advances BUILD once. The GitHub title is
**t3-obsidian VERSION**, without a development-stage label.
The Obsidian display name stays **T3 Code**.

[release-policy.json](../release-policy.json) enforces this rule. Stay in alpha
until the user explicitly says to leave it. Neither a breaking change, a large
feature, nor a high build number authorizes graduation. Retrying an existing
immutable archive keeps its version and bytes. Do not add `-alpha` to new
manifests or tags; Obsidian's documented distribution format is plain `x.y.z`.

## Comparison history

The release queue maintains private Markdown and CSV tables under
`evidence/version-history/` in the integration checkout. They preserve the
reviewed historical rows, links, original numbers, and all alternative version
columns. Registered existing task-worktree evidence directories receive the
same updated tables. Do not publish these private thread records to GitHub.

Every newly assigned release adds one row with its source commit, thread link,
change description, comparison versions, and delivery status. Packaging,
installation, and completed live verification update that row. Retries do not
add another row. Failed candidates remain traceable; archived bytes and old
release records remain immutable. Keep every comparison column until the user
explicitly graduates from alpha.

New plugin releases preserve the submitted task commits on `main` without
squashing. A merge commit titled `Release VERSION: summary` joins the canonical
branch and task tip, with the resolved source tree and final version files.
Its commit ID is the archive and deployment provenance. The private history
also records the original task source commit and thread link. Historical
releases and already packaged retries retain their existing records.

Use `--thread-id ID --summary "CHANGE"` with `--enqueue HEAD` to record the
owning T3 thread and a useful public commit description. Use `--release-type patch`, `minor`,
`major`, or `none` for the alternative comparison counters. This classification
does **not** change the published alpha format, including for prepared candidates:

- `patch`: correct behavior without removing a supported capability.
- `minor`: add a compatible capability or deprecate one.
- `major`: remove or incompatibly change a supported command, workflow, setting,
  saved-note format, or connection requirement. The major-zero comparison
  advances its minor component instead of leaving zero.
- `none`: documentation, tests, source moves, or delivery tooling alone. The
  semantic comparison counters stay unchanged. Such work normally integrates
  without a local plugin installation. Pushing it to main still requires a new
  alpha build and automatic GitHub release, without advancing those counters.

These comparison rules follow the chosen historical interpretations of
[Semantic Versioning](https://semver.org/), rather than claim that the old
numbers prove one uniquely correct reconstruction. The current alpha stage is
an explicit development policy, not a promise of a stable public interface.

## Historical transitions and distribution

The original `2.45.81` → `0.0.377-alpha` transition remains a historical record.
After the suffix-format correction, the queue continues from the highest alpha
build, including prior suffixed versions and reserved numbers, and assigns the
next plain numeric build. Older `2.x` receipts must not override that sequence.
Never rewrite historical tags, archives, receipts, or comparison rows. The
reviewed private seed is supplied once with `--history-seed PATH`; later jobs
use the retained history.

Every push to `main`, including a merged PR or maintenance-only change, must
carry a strictly newer, unused numeric version in all version files. The GitHub
workflow creates the matching tag, builds and attests its assets, then publishes
a regular release titled `t3-obsidian VERSION`. It does not bump versions itself.
Feature-branch pushes do not create releases. The local delivery queue remains
separate; its eventual replacement by PR-based delivery is not part of this change.
The GitHub prerelease flag is not the
project's development-stage switch. Confirm the current
[Obsidian submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
when submitting or resubmitting to the plugin directory.

New GitHub release assets must carry provenance for their exact numeric tag and
reviewed queue commit. Use the checked publication procedure in
[Review and release checks](review-and-release.md). This does not change alpha
numbering, private comparison counters, or immutable historical releases.
