# Contributing

Open an issue before a large change. Describe the result you want and include
steps to reproduce a defect. Keep notes, logs, credentials and other private
content out of issues and pull requests.

Use Node.js 22 and run `npm ci`. Work in a source checkout, then run `npm test`
to check the changed features and their consumers. `npm run build` writes the
plugin to `dist/`. Use a separate test vault and keep its settings private.

Keep desktop APIs behind explicit platform guards. Preserve mobile support,
Obsidian 1.8.7 compatibility, native rendering and the HTML sandbox. Include
relevant test results in your pull request.

Complete the affected checks in the development run, review and commit your
changes, then push the task branch and open a PR. Include the results and any
remaining limits; use a draft if required checks are incomplete. Do not defer
validation to publication. Read [the development checks](docs/review-and-release.md)
and [version policy](docs/versioning.md). Release work stays on GitHub after
PR review; ordinary contributions do not bump versions or install the plugin.
