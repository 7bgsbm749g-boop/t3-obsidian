# Alpha version policy

The project remains in **alpha**, with plain **`0.0.BUILD`** versions in the
Obsidian manifest, package files, compatibility map, and matching release tag.
The GitHub title is **t3-obsidian VERSION**, without a development-stage label.
Alpha is the development stage; do not add it to new titles, versions, or tags.
The Obsidian display name stays **T3 Code**.

Only an explicit user instruction can end alpha. A breaking change, large
feature, or high build number does not authorize graduation. Keep all version
files aligned for a release and preserve every published version.

## PRs and releases

Ordinary development work ends in a reviewed commit and PR. Every PR needs a
strictly newer unused `0.0.BUILD` aligned across all version files before merge,
including documentation and workflow-only changes. Release work stays on GitHub
after PR review. The local version allocator, queue, packaging, deployment and
publication tools have been removed. This
change adds no replacement release automation. See
[Review and release checks](review-and-release.md).

The existing GitHub workflow validates PR versions. Every main push, including
a merged PR, authorizes automatic publication: reserve the numeric tag for the
exact source commit, dispatch its build, attest the assets, then publish. The
workflow does not assign versions. It verifies the numeric tag against
`manifest.json`, `package.json`, both package-lock version fields, and the
`versions.json` compatibility entry before building and attesting assets.
Feature-branch pushes do not publish. Developing agents stop at the PR; GitHub
owns publication after merge. [release-policy.json](../release-policy.json) and
`scripts/release_policy.py` remain inputs to this GitHub workflow.

## Historical records

Preserve existing tags, archives, receipts, private source refs, and private
Markdown/CSV comparison tables. Keep original numbers, links, all alternative
version columns, and delivery states. These private records are historical;
they are no longer updated by a local release worker. Do not upload private
thread records or evidence to GitHub.

The original `2.45.81` to `0.0.377-alpha` transition and the later correction to
plain numeric alpha builds remain historical facts. Do not renumber them,
rewrite immutable assets, or let older `2.x` numbering replace the alpha
sequence. Keep every comparison format until the user explicitly leaves alpha.
