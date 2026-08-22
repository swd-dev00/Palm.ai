# Palm.ai GitHub Actions Runner Setup

Palm.ai now uses **GitHub Actions** for its hosted execution path. The existing Local Runner and Local Browser Runner remain the preferred path for local-only files and browser-dependent work. GitHub Actions handles only cloud-uploaded attachments and fixed, read-oriented handlers.

## Repository files

The initial repository commit adds the following GitHub Actions pieces.

| File | Purpose |
|---|---|
| `.github/workflows/palm-runner.yml` | A manually dispatched, 15-minute GitHub-hosted workflow. |
| `githubActionsRunner.ts` | Palm server client for workflow dispatch and cancellation. |
| `palm-github-actions-runner.mjs` | Worker that obtains a short-lived assignment, downloads cloud uploads, emits ordered events, and deletes its workspace. |
| `runnerRuntime.ts` | Queues every `local_file`, `local_browser`, or local-reference task exclusively for a matching Local Runner; it may use GitHub Actions only for eligible cloud work. |

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

> GitHub-hosted execution is not the right path for local files, local browser state, or browser writes. `selectRunnerAdapter()` now returns no hosted fallback for a task that requires local execution, and `runnerRuntime.ts` retains the task in the matching Local Runner queue when no device is online.

## Local Runner connection security

Local Runner and Local Browser Runner traffic is separate from the GitHub Actions protocol. After deploying the updated server, both clients require an `https://` `PALM_BASE_URL`, validate the normal system certificate chain, refuse insecure redirects, and sign every request with an HMAC over its method, path, timestamp, nonce, and body hash. The server accepts only requests inside a 60-second window and records each runner nonce once, preventing replay. It also binds a local execution run to its exact claiming device, so another registered device cannot submit its events or request browser approvals.

Deploy the `0013_secure_local_runner_transport.sql` migration before updating any Local Runner clients. Re-register or rotate every Local Runner token during rollout, because the token is the HMAC key. Do not place this token in shell history, a URL, source code, browser storage, or a synchronized home-directory dotfile.

## First-run checklist

1. Deploy the Palm server with the server configuration above.
2. Run the database migration set, including the updated runner schema migration.
3. Add the two repository secrets.
4. Manually trigger **Palm GitHub Actions runner** once with a harmless numeric test run ID only after the Palm server can issue that run.
5. Submit a task with a small cloud-uploaded text or CSV file. Confirm the Palm task trace shows `run.dispatching`, `runner.provisioning`, `github_actions.started`, and `github_actions.completed`.
6. Submit a task with a Local-only attachment or `local_file`/`local_browser` target while GitHub Actions is configured. Confirm it remains queued for the matching Local Runner and is not sent to GitHub Actions.
7. Start each updated Local Runner against the public HTTPS hostname. Confirm a valid signed heartbeat succeeds, while a request with an altered body, stale timestamp, reused nonce, or different device-run binding is rejected.

## Validation limitations

Focused routing and Local Runner security tests now cover local-only no-fallback selection, HMAC/body integrity, timestamp freshness, nonce replay rejection, device-run binding, and existing approval controls. The full repository suite is still not a production-release gate until real production authentication, object storage, database migration journal normalization, and end-to-end Oracle deployment tests are completed.

## References

[1] [GitHub REST API — Create a workflow dispatch event](https://docs.github.com/rest/actions/workflows)

[2] [GitHub Actions — Authentication in a workflow](https://docs.github.com/actions/reference/authentication-in-a-workflow)
