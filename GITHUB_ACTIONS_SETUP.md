# Palm.ai GitHub Actions Runner Setup

Palm.ai now uses **GitHub Actions** for its hosted execution path. The existing Local Runner and Local Browser Runner remain the preferred path for local-only files and browser-dependent work. GitHub Actions handles only cloud-uploaded attachments and fixed, read-oriented handlers.

## Repository files

The initial repository commit adds the following GitHub Actions pieces.

| File | Purpose |
|---|---|
| `.github/workflows/palm-runner.yml` | A manually dispatched, 15-minute GitHub-hosted workflow. |
| `githubActionsRunner.ts` | Palm server client for workflow dispatch and cancellation. |
| `palm-github-actions-runner.mjs` | Worker that obtains a short-lived assignment, downloads cloud uploads, emits ordered events, and deletes its workspace. |
| `runnerRuntime.ts` | Selects Local Runner first, then GitHub Actions when configured, then the built-in runtime. |

## Palm server configuration

Set the following values in the **Palm server environment**, not in browser code.

| Variable | Value | Required |
|---|---|---|
| `GITHUB_ACTIONS_OWNER` | `swd-dev00` | Yes |
| `GITHUB_ACTIONS_REPO` | `Palm.ai` | Yes |
| `GITHUB_ACTIONS_WORKFLOW` | `palm-runner.yml` | Yes, unless the workflow is renamed |
| `GITHUB_ACTIONS_REF` | `main` | Yes; use a protected branch |
| `GITHUB_ACTIONS_DISPATCH_TOKEN` | Fine-grained token or GitHub App installation token limited to this repository with **Actions: write** | Yes |
| `GITHUB_ACTIONS_RUNNER_SHARED_SECRET` | A randomly generated value of at least 32 characters | Yes |

The workflow dispatch endpoint requires a token with repository **Actions: write** permission. [1] Keep the dispatch credential server-side. It is never exposed to the browser or sent as a workflow input.

## Repository secrets

Open the repository’s **Settings → Secrets and variables → Actions**, then add these two repository secrets.

| Secret | Value |
|---|---|
| `PALM_BASE_URL` | Public HTTPS base URL of the deployed Palm server, for example `https://palm.example.com` |
| `PALM_RUNNER_SHARED_SECRET` | The exact value of `GITHUB_ACTIONS_RUNNER_SHARED_SECRET` |

The workflow input contains only a numeric Palm run ID. The worker proves possession of `PALM_RUNNER_SHARED_SECRET` to obtain a short-lived signed manifest URL and per-run event token from Palm. Do not add task prompts, signed URLs, database credentials, or dispatch tokens as workflow inputs.

## GitHub workflow safety boundary

The workflow intentionally uses only `contents: read`, a pinned checkout action revision, and a 15-minute timeout. GitHub recommends setting the minimum `GITHUB_TOKEN` permissions necessary for a workflow. [2] The worker accepts only HTTPS attachment URLs and executes no user-provided shell commands.

> GitHub-hosted execution is not the right path for local files, local browser state, or browser writes. Those tasks remain queued for the existing user-machine runners.

## First-run checklist

1. Deploy the Palm server with the server configuration above.
2. Run the database migration set, including the updated runner schema migration.
3. Add the two repository secrets.
4. Manually trigger **Palm GitHub Actions runner** once with a harmless numeric test run ID only after the Palm server can issue that run.
5. Submit a task with a small cloud-uploaded text or CSV file. Confirm the Palm task trace shows `run.dispatching`, `runner.provisioning`, `github_actions.started`, and `github_actions.completed`.
6. Submit a task with a Local-only attachment. Confirm it remains queued for the Local Runner and is not sent to GitHub Actions.

## Validation limitations

The migration-specific dispatch client, runner event security, and Local Runner routing tests pass in the imported archive. The full archived test suite is not a release gate yet because this export omits several directories referenced by pre-existing tests, including `client/src/`; two pre-existing runner-scope assertions also disagree with the bundled scope helper. Resolve those archive-level gaps before treating the repository as production-ready.

## References

[1] [GitHub REST API — Create a workflow dispatch event](https://docs.github.com/rest/actions/workflows)

[2] [GitHub Actions — Authentication in a workflow](https://docs.github.com/actions/reference/authentication-in-a-workflow)
