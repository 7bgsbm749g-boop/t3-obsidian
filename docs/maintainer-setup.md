# Local validation setup

Contributors can build and test without access to a production vault. The local
release process has been removed. Completed development work ends in a commit
and PR; release work stays on GitHub after review.

Machine settings remain in `t3-obsidian/maintainer.json` inside the Git common
directory, shared by linked worktrees and never committed. Find it with
`git rev-parse --path-format=absolute --git-common-dir`.
`T3_OBSIDIAN_MAINTAINER_CONFIG` can select a different local JSON file.

The validation tools use these values:

- `canonicalRoot`: the main source checkout used to resolve existing local settings.
- `evidenceRoot`: an absolute directory outside all source checkouts and synced
  vaults. Keep check logs, source hashes, behavior results, and cleanup proof here.
- `developmentPlugins` and `productionPlugins`: optional protected plugin-parent
  directories. Native lab tools use them to reject real-vault destinations.

Keep private operating instructions in `t3-obsidian/AGENTS.md` beside the JSON.
Read them with `python3 scripts/maintainer_config.py --instructions`. Keep
credentials out of both files. Remove obsolete local release instructions;
release-service, deployment, and checkout-cleanup settings have no local consumer.

`python3 scripts/maintainer_config.py --evidence-root` prints the evidence store.
Native lab tools share `scripts/evidence-paths.mjs`; they accept external paths
and reject other projects, symlink escapes, and real synced vaults. Retain the
existing synthetic Sync lab for development checks when Sync behavior changes.

See [Review and release checks](review-and-release.md) for validation and the
commit-and-PR flow. Use an explicit push refspec and disable tag following.
Prepare the newer aligned version required by the GitHub PR check. Do not
merge, install, tag, or publish locally as a normal completion step.
Keep private evidence and historical release records outside GitHub.

## Existing release services

Do not restart or reuse an old queue or automatic client reload worker. If a
machine still has those services installed, retire its owned path watch and
retry/reload timers, then stop and disable its release worker under that
machine's operating rules. Preserve historical jobs, archives, receipts, source
refs, private comparison tables, active worktrees, and user data. Removing the
source tools does not remove service definitions from another machine.
