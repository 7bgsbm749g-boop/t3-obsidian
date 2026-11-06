# Local maintainer setup

The public plugin does not need the maintainer's machine paths. Normal
contributors can build and test the source without access to a production vault.

Machine settings are read from `t3-obsidian/maintainer.json` inside the Git common
directory. Find that directory with `git rev-parse --path-format=absolute
--git-common-dir`; a worktree's `.git` can be a file, so do not assume it is a
directory. The settings are shared by the repository's linked worktrees and are
never committed. `T3_OBSIDIAN_MAINTAINER_CONFIG` can select a different local file.

The JSON object accepts these local values:

- `canonicalRoot`: the integration checkout's absolute path.
- `evidenceRoot`: an absolute directory outside every source checkout, shared by
  the project's linked worktrees. Release locks, queues, checks, receipts, and
  private version tables use this location. Existing legacy symlinks can retain
  historical paths while new evidence uses the external directory directly.
- `developmentPlugins` and `productionPlugins`: the plugin-parent directories in
  the development and production vaults. Existing device settings are preserved.
- `obsidianCli`: the local Obsidian Sync CLI executable.
- `syncService`: the system service that owns production Sync.
- `responseHostUnit`: the local background-response service definition.
- `releaseQueueUnit`: the queue service name, without a suffix.
- `t3Command` and `t3BaseDir`: the T3 executable and its data directory. These let
  completed jobs request checkout removal through T3 before deleting a branch.

Keep private operating instructions in `t3-obsidian/AGENTS.md` beside the JSON.
Read them with `python3 scripts/maintainer_config.py --instructions`. Do not put
credentials in either file. Publication requires explicit deployment settings;
the tools do not guess a personal vault.

`python3 scripts/maintainer_config.py --evidence-root` prints the resolved store.
Native lab tools share `scripts/evidence-paths.mjs`; they accept direct external
paths and reject other projects, symlink escapes, and real synced vaults.

## Push and publication scope

Keep the private guide consistent with the public `AGENTS.md`: a push request
uploads reviewed commits only. It does not request a version, release tag,
queue job, vault installation, GitHub release, or directory review. Read the
shared private guide before an authorized push and disable implicit tag
following with an explicit branch refspec. GitHub publication requires its own
explicit authorization; the QLO2 delivery default is a separate scope.

Branch pushes and pull requests do not run hosted build checks. Numeric release
tags run `.github/workflows/release-provenance.yml`, which still lints, builds,
and attests all three published assets. Keep those attestations to address the
directory recommendation. See [Review and release checks](review-and-release.md)
for both procedures. Workflow-only edits use source-only queue maintenance,
with no plugin version or installation.

## Documentation and skills

Commit documentation and skill instructions normally. To integrate one reviewed
commit into the configured canonical checkout, run:

```sh
python3 scripts/integrate_docs.py COMMIT
```

The helper checks that the commit changes only documentation or skill metadata,
then runs a normal Git cherry-pick under the existing repository lock. It creates
no release job, changes no plugin version, and runs no build or installation.
Conflicts leave the source branch intact and restore the canonical checkout.
The release command also redirects documentation-only `--enqueue` requests to
this ordinary Git route, so an old habit does not create a plugin release.

## Finished release branches

Deleting a checkout does not delete its branch. New release requests record the
source branch and exact submitted commit. After successful delivery, the worker
requests removal through T3, then removes the local branch. Active processes,
pending T3 work, uncommitted files, unexpected ignored files, other checkouts,
and newer branch commits prevent removal. Cleanup status is retained in the job.
Historical requests without the source-branch record are not deleted in bulk.

After a fresh native T3 idle check, a finished clean task branch can be aligned
with its exact integrated commit once that commit is on `origin/main`. The
original source stays reachable through private queue refs. A Git ref transaction
rejects a newer commit racing the check; local edits and colliding ignored files
also block alignment. This clears already-published changes from T3's branch
comparison without changing published history. Retained files can still prevent
checkout removal after alignment. An external evidence compatibility symlink
can be removed with the checkout; its external target is preserved.

The existing queue retry timer retries busy checkout cleanup with bounded
backoff. The queue's directory watch also wakes when Git worktrees are removed.
Run the existing `--install-queue` operation once after updating its watcher
definition. No additional polling service is required.
