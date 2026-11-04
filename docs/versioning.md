# Alpha version policy

Releases use **`0.0.BUILD-alpha`** everywhere: the Obsidian manifest,
package files, compatibility map, archive, Git tag, and GitHub release title.
The approved starting version is **`0.0.377-alpha`**. Each new packaged release
advances the build once: `0.0.378-alpha`, `0.0.379-alpha`, and so on. Retrying an
existing immutable archive keeps its version and bytes.

[release-policy.json](../release-policy.json) enforces this rule. Stay in alpha
until the user explicitly says to leave it. Neither a breaking change, a large
feature, nor a high build number authorizes graduation. Do not substitute a
numeric-only version on another platform. GitHub titles are
**t3-obsidian VERSION**; the Obsidian display name stays **T3 Code**.

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

Use `--thread-id ID --summary "CHANGE"` with `--enqueue HEAD` to record the
owning T3 thread and a useful description. Use `--release-type patch`, `minor`,
`major`, or `none` for the alternative comparison counters. This classification
does **not** change the published alpha format, including for prepared candidates:

- `patch`: correct behavior without removing a supported capability.
- `minor`: add a compatible capability or deprecate one.
- `major`: remove or incompatibly change a supported command, workflow, setting,
  saved-note format, or connection requirement. The major-zero comparison
  advances its minor component instead of leaving zero.
- `none`: documentation, tests, source moves, or delivery tooling alone. The
  semantic comparison counters stay unchanged. Such work normally integrates
  without a plugin release; an explicit delivery-tool verification release
  still advances its alpha build.

These comparison rules follow the chosen historical interpretations of
[Semantic Versioning](https://semver.org/), rather than claim that the old
numbers prove one uniquely correct reconstruction. The current alpha label is
an explicit development policy, not a promise of a stable public interface.

## Initial transition and distribution

Only the explicitly approved `2.45.81` → `0.0.377-alpha` transition may replace a
larger legacy numeric version. Later alpha releases must increase their build.
Never rewrite historical tags, archives, or receipts. The reviewed private seed
is supplied once with `--history-seed PATH`; later jobs use the retained history.

The official Obsidian community submission rules require plain `x.y.z` versions.
This user-approved suffix is for the current alpha distribution; a successful
local plugin load does not establish community-directory acceptance. See the
[Obsidian submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin).
