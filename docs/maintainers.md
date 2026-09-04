# Maintainer guide

This project is intentionally selective about what reaches `main`. The goal is
to keep the public repository useful to a new contributor while preserving a
clear safety and evidence boundary.

## Review sequence

1. Confirm the PR has a focused scope, a linked issue when appropriate, and no
   generated state, credentials, or internal sprint notes.
2. Review API, protocol, safety, and hardware claims. Require a dated hardware
   record before accepting `HARDWARE_VERIFIED` language.
3. Apply the `ci:run` label only after the proposal is ready for the test gate.
4. Wait for the selected CI matrix to pass, resolve review comments, and merge
   from the GitHub UI. Keep `main` protected from direct pushes where possible.

The CI workflow also supports manual dispatch with an optional PR number. It
checks the PR merge ref and has read-only repository permissions. It does not
receive release, registry, cloud, or hardware credentials.

## Labels

- `triage`: maintainer review is still in progress.
- `ci:run`: explicit maintainer opt-in to consume the CI matrix.
- `bug`, `enhancement`: issue type.
- `security`: use only for non-sensitive coordination; never include exploit details.

## Merge and release boundaries

Merging a PR is separate from publishing packages or creating a release. The
alpha release workflow is manual, validates an existing approved tag, and keeps
its publish job behind both an explicit input and the protected `alpha-release`
environment. Do not create tags, publish to npm/PyPI, or create a GitHub Release
as part of routine PR maintenance.
