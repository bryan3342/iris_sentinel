# Claude Automation and Guardrails

Iris uses the Claude GitHub App (`anthropics/claude-code-action`) for three jobs. This page lists what each job may do and the guardrails around it, each tied to Anthropic's guidance:

- [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions)
- [claude-code-action security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)

## Workflows

| Workflow | Runs when | What it does | Can change code? |
| :--- | :--- | :--- | :--- |
| `claude-pr-review.yml` | A PR is opened, reopened, or a human pushes new commits | Fixes bugs and code smells in the changed code on the PR branch, posts one summary comment, marks a draft PR ready | Yes, on the PR branch only |
| `claude.yml` | Someone writes `@claude` in an issue or comment | Answers in the thread | No |
| `claude-issue-check.yml` | An issue is opened or edited | Comments only if the title or label breaks conventions | No |

## PR flow

1. Open the PR as a **draft**.
2. The PR agent reviews, pushes fixes to the PR branch, comments, and marks the PR ready.
3. Each later human push gets a review of just the new commits.
4. A human reviews and merges. Nothing merges automatically.

To keep the agent off a PR, add the `no-claude` label.

## Guardrails

| Guardrail | How it is enforced | Source |
| :--- | :--- | :--- |
| Only people with write access can trigger runs | The action checks write access; the PR job also requires an owner, member or collaborator author | Security doc, "Access Control"; GitHub Actions doc, "Who can trigger runs" |
| No bot loops | The job skips bot actors and bot senders; the action also rejects bot actors because `allowed_bots` is left unset | GitHub Actions doc, "Who can trigger runs" |
| Fork PRs never run with secrets | Only same-repo PRs run; the workflow uses `pull_request`, never `pull_request_target` | Security doc, "Using this action with pull_request_target" |
| Least privilege | Each job declares only the permissions it needs; only the PR agent has `contents: write` | GitHub Actions doc, "Protect your credentials" |
| No push outside the PR branch | The only allowed push command is `git push origin HEAD:refs/heads/<PR branch>`; no force, amend or rebase | Capabilities doc, "Cannot merge branches, rebase" |
| No merging or approving | No merge or approve command is allowed; the action cannot approve PRs | Capabilities doc, "Approve PRs" |
| Explicit tool allowlist | `--allowedTools` lists every command; anything unlisted is blocked | GitHub Actions doc, "Run on a schedule" (tool grants) |
| No outbound web access | `--disallowedTools "WebFetch,WebSearch"` on every workflow | Security doc, "Prompt Injection Risks" |
| Prompt injection | Run only for trusted authors; the prompt treats PR text and code comments as data; the action strips hidden markdown | Security doc, "Prompt Injection Risks" |
| Agent rules can't be changed by a PR | The action restores `CLAUDE.md` and `.claude/` from the base branch | Security doc, "Which files come from the base branch" |
| Workflow files can't be changed by a PR | The action only runs a workflow identical to the one on `main`; the agent may not edit `.github/` | Action workflow validation |
| Credentials stay secret | Token stored as the `CLAUDE_CODE_OAUTH_TOKEN` secret; `show_full_output` stays off | Security doc, "Authentication Protection" and "Full Output Security Warning" |
| Cost limits | `--max-turns`, job `timeout-minutes`, one queued run per PR via `concurrency` | GitHub Actions doc, "Manage costs" |
| Human review before merge | PRs end as "ready for review"; a human merges | GitHub Actions doc, "review Claude's changes before merging" |

## Known limits

- **`main` is not branch-protected.** GitHub's free plan does not offer branch protection on private repositories, so the workflow's push rule is the protection.
- **PR scripts run with a write token.** `npm ci` and `npm test` run scripts from the PR's own `package.json` while the job holds `contents: write`. Only trusted authors can trigger the job, which is the guard. Revisit this before accepting outside contributors.
- **The OAuth token is tied to one subscription.** For shared or organization use, Anthropic recommends a Claude Console API key or workload identity federation instead.
