# Pinned Obsidian review rules

The npm 0.4.2 archive predates rules in the current directory review. The adjacent
archive contains the official Obsidian linter at the exact upstream commit in
`obsidian-linter-source.json`, transpiled with the project’s locked esbuild.
Upstream source and license are unmodified. Package metadata records the source
archive hash and build recipe.

Rebuild with `node scripts/build-review-linter.mjs`. The script downloads the
immutable source, builds it in an owned temporary directory, packs the upstream
package and removes the temporary directory in a finally block. An optional first
argument supplies a previously downloaded source archive.

This is development tooling. It is excluded from the plugin bundle and vaults.
ESLint 9.39.5 matches the upstream tested major; moving to a newer major requires
checking the upstream plugin dependencies’ declared support first.
