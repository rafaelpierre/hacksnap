# Working on Hacksnap

These instructions apply to `hacksnap/` and its descendants. Frontend guidance
below applies to `web/`. Also follow the repository root `AGENTS.md`.

## Start each issue in an isolated worktree

1. Read the issue, relevant code, `README.md`, and `web/README.md`. Identify the
   expected behavior and how to verify it before editing.
2. Inspect `git status` and existing worktrees. Preserve other people's changes;
   never reset, stash, or overwrite unrelated work automatically.
3. Refresh main. In a clean checkout of `main`, run `git pull --ff-only origin main`.
   If that checkout has uncommitted work, run `git fetch origin main` and use
   `origin/main` directly as the base for the new branch.
4. Create a descriptive `codex/<issue>-<short-description>` branch from the fresh
   main revision and a new worktree for it. For example, from the repository root:

   ```sh
   git fetch origin main
   git worktree add -b codex/123-story-navigation ../hacksnap-123 origin/main
   cd ../hacksnap-123
   ```

5. Do all development, dependency installation, checks, and commits in that
   worktree. Reuse it when continuing the same issue. Verify the working directory
   and branch before changing files. Keep local servers on separate ports.
6. Keep the change focused. Explain material tradeoffs and blockers as they arise.
   Avoid unrelated refactors, dependency upgrades, or generated-file changes.

## Frontend structure and implementation

- Use Node.js 22 and npm. Install from `web/` with `npm ci`; commit
  `package-lock.json` alongside intentional dependency changes.
- Follow the existing Next.js App Router, React, and strict TypeScript setup.
  Routes and UI live in `web/app/`; shared data access and logic live in
  `web/lib/`; tests live in `web/tests/`.
- Prefer Server Components for data loading and static content. Add `"use client"`
  only where interaction or browser APIs require it, and keep that boundary small.
- Keep database access in server-only modules. Reuse `lib/data.ts` and its
  connection, read-only, timeout, and TLS safeguards. Never expose credentials in
  client bundles, `NEXT_PUBLIC_*` variables, logs, or error responses.
- Treat story content, URLs, query parameters, and stored browser values as
  untrusted input. Validate at boundaries, use parameterized queries, escape
  output for its format, and avoid rendering unsanitized HTML.
- Keep types precise and reuse existing domain types and helpers. Avoid `any`,
  blanket type assertions, duplicated business rules, and speculative abstractions.
- Make initial server output and hydration agree, including dates and theme state.
  Guard browser APIs and handle unavailable storage. Clean up effects, listeners,
  timers, and other resources.
- Preserve useful server-rendered content and ordinary links when JavaScript is
  unavailable. Handle empty, pending, missing, and error states explicitly.
- Preserve route validation, canonical URLs, pagination, and story return/scroll
  behavior. Keep HTML, Markdown, RSS, API output, and metadata consistent when
  changing shared content or story semantics.
- Preserve documented caching behavior. Homepage and story ISR, shared data
  caches, and content negotiation need deliberate changes and verification.
  The production build must continue to work without database credentials.
- Reuse existing dependencies and components before adding new ones. Consider
  client JavaScript, network requests, image sizes, and layout shifts when adding
  UI. Keep fonts local and preserve the existing analytics loading strategy.
- Update the relevant README when behavior, configuration, or commands change.
  Schema and ingestion changes belong in their existing modules; follow the
  applicable database skills before changing database definitions or policies.

## Design and accessibility

- Reuse semantic colors, type scale, spacing, reading widths, responsive gutters,
  and control-size tokens from `web/app/globals.css`.
- Follow the typography and theme conventions in `web/README.md`. Support System,
  Light, and Dark appearance, including saved preferences and blocked storage.
- Use semantic HTML, real links for navigation, and buttons for actions. Give
  controls accessible names, preserve visible keyboard focus, and make every
  interaction usable by keyboard and touch. Do not rely on color or hover alone.
- Maintain the shared 44px control target and readable contrast. Respect reduced
  motion. Avoid truncation or fixed dimensions that hide essential content.
- For visible UI changes, inspect affected pages at 320px and desktop widths, in
  both themes and at 200% text size. Check wrapping, overflow, focus order, touch
  targets, and loading/empty/error states. Capture useful screenshots for the PR.
- Test navigation and browser back/forward behavior when changing routing,
  pagination, menus, or scroll restoration. Report any browser checks you could
  not perform.

## Local validation

Run these commands from `web/` before publishing implementation changes:

```sh
npm ci
npm run lint
npm run format:check
npm run test:ci
npm run typecheck
npm run build
```

- Oxlint handles linting; Oxfmt handles formatting. Use `npm run format` to fix
  formatting, inspect its diff, then rerun the checks. Do not disable rules or
  weaken checks merely to make a failure disappear.
- Jest runs unit and component tests using ESM, SWC, and jsdom. Add meaningful
  regression coverage for changed behavior and bug fixes using the existing
  patterns. Keep tests deterministic and independent of network access, live
  databases, servers, and credentials.
- Use `npm test -- tests/<file>.test.mjs` (or `.test.tsx`) during development;
  run the full suite before publishing. Preserve the configured test timezone,
  which exercises date boundaries. Restore globals and mocks after tests.
- Fix failures and rerun affected checks. If a failure is unrelated or the
  environment blocks validation, identify the exact failure and report it;
  never describe an unrun or failing check as passing.
- For worker changes, also run `uv run --directory hacksnap pytest` and
  `uv run --directory hacksnap ruff check pipeline tests modal_app.py` from the
  repository root. For ingestion changes, run `uv run --directory data pytest`.
  `.github/workflows/hacksnap.yml` is the source of truth for CI commands.
- Documentation-only changes need content/link review and `git diff --check`;
  no new behavior tests are needed. Respect any broader validation requested by
  the user.

## Commit, push, and pull request

1. Review the complete diff and run `git diff --check`. Stage only intended files.
   Keep secrets, local configuration, build output, and dependency directories out
   of commits.
2. Once checks pass, commit with a clear message and push the feature branch with
   `git push -u origin <branch>`. If the user asks only for a local draft, leave it
   available for review and report its path.
3. Create a PR against `main`, or update the existing PR for this branch. Describe
   the problem, resulting behavior, linked issue, validation results, and any
   remaining limitations. Include screenshots for visible UI changes.
4. Check PR mergeability and CI results. If conflicts exist, fetch the latest main
   and run `git rebase origin/main` in the feature worktree with a clean working
   tree. Resolve conflicts while preserving both sides' intended behavior.
5. After rebasing, rerun the required checks and inspect the diff. Update the remote
   feature branch with `git push --force-with-lease`; never use plain `--force` or
   force-push main. If the lease fails, inspect the remote changes before retrying.
6. Confirm the PR is conflict-free and required CI checks pass after the final push.
   Address failures, or report the specific blocker. Summarize the change, checks,
   PR link, and remaining work for the user.
7. Merging changes matched by `.github/workflows/hacksnap.yml` into `main`
   triggers pending schema migrations through the reusable Supabase workflow after
   validation, then Modal deployment after the schema preflight. Both production
   steps check that the run still matches current `main`.
   Follow the user's authorization before merging or manually deploying; approval
   to create or push a PR does not authorize merging it. Standalone manual schema
   rollouts still require authorization. Follow the instructions in `hacksnap/README.md`
   and never trigger a production workflow as part of local validation.
