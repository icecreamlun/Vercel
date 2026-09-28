# Validation record

Validated locally on 2026-09-27 (America/Denver; report timestamps use UTC on September 28). All model-backed runs used real Vercel Sandbox and Anthropic calls. No result was fabricated or changed to make a release pass.

## Real evaluation runs

| Run | Candidate | Baseline | Candidate | Gate | Notes |
| --- | --- | --- | --- | --- | --- |
| `c379764` | A | 7/8 | 7/8 | Blocked | Improved noisy intent; regressed on expired refund. |
| `c7512e5` | B | 8/8 | 8/8 | Passed | Worker was restarted during collection; same command reattached. |
| `aa19f98` | B | 8/8 | 8/8 | Passed | Subsequently promoted through five concurrent API requests. |
| `c81920a` | B | 8/8 | 8/8 | Passed | Worker killed after confirming a live remote Node process. |
| `889074f` | A | 8/8 | 7/8 | Blocked | Expired refund regression. |
| `2ef3c11` | A | 7/8 | 7/8 | Blocked | Improved noisy intent; regressed on expired refund. |

A was blocked in all three completed comparisons; B passed all three. Baseline behavior varied on a noncritical example, so this does **not** demonstrate a consistent aggregate improvement. The useful result is that the critical policy violation is observable and blocks release even when the average does not decline.

[Machine-readable results](validation-runs.json) include every recorded evaluation, including failed integration runs and fault injections. Full evidence is retained in the local database and `.local/report-*.json`. Two actual reports are bundled as explicitly labelled, read-only examples in `fixtures/reports/`; they cannot be promoted into a visitor's project.

## Fault experiments

**Live Worker restart — passed.** Run `c81920a3bc55ecce90bf78f171954251` had a running Node benchmark confirmed by the remote process list. The local Go worker was killed with SIGKILL at `2026-09-28T00:37:49.673Z`, then restarted. Baseline command `cmd_f823e5a802cf408fa621d127e908` stayed the same; the execution lease advanced from 1 to 2. The run finished with all 16 results, no repeated attempt, and both sandboxes cleaned up.

**Sandbox loss — passed.** In run `4b8c0f48e453d3c70e53265e22ec33a4`, the baseline sandbox was stopped and deleted while its Node runner was alive. The run became `error / unavailable`; both sandbox records were marked cleaned up. No candidate benchmark or replacement attempt was started, and publication remained unavailable.

The earlier loss experiment `e934f57` exposed the SDK's automatic resume behavior on its Sandbox convenience methods. A stopped nonpersistent environment could trigger a failed resume attempt. The adapter now uses the public `currentSession()` API for commands and file operations, binding requests to the original VM. The second experiment above tested this repair.

An initial integration run `e9211e` failed because the image's default command working directory differed from the assumed directory. Paths are now absolute and remote hashes are verified before benchmark execution. Command completion also uses the SDK wait endpoint: metadata alone may omit an exit code. These failures remain in the history.

## Release and Playground

`aa19f983bfafc4c08bc2b65e68ac0244` was promoted with five simultaneous HTTP requests. All returned release `3581a4f97f9df87fc355476ce1669047`; generation advanced exactly once, from 1 to 2. A separate session received 404 for both reading and promoting that run and retained its own baseline release.

Two subsequent real Playground jobs used that release and prompt SHA-256 `9f25604ecfa20d344e922f12d6544860b4e4a2dc30ac1ae747b6c85784dea9ee`:

- `592d5c3`: expired order ORD-2048 → `deny`, no refund tool call.
- `9633101`: valid order ORD-1042 → `refund`, exactly one refund tool call.

## Automated checks

- Go unit and PostgreSQL transaction tests pass with the race detector. Concurrent promotion, idempotent retries after Reset, stale release rejection, ownership, budget rollback, admission idempotency, and stale lease rejection are covered.
- Runner tests verify that disallowed refund attempts remain visible, invalid tool arguments are recorded, and invalid final schemas are rejected.
- Go tests verify critical regression gating, protocol versus platform failure semantics, missing/foreign artifact rejection, tool evidence overriding self-report, and required request origin/header protection.
- The Next.js production build and TypeScript check pass.
- GitHub source verification passes for all three pinned regular-file blobs.

## Limits of verification

Browser access to localhost was declined by the computer-use permission policy. Visual layout, responsive rendering, focus behavior, and browser click flows have **not** been visually verified. The UI is implemented with keyboard focus trapping, responsive layouts, reduced-motion support, and explicit empty/error states, but source inspection and build success do not replace browser testing.

No production backend host, managed PostgreSQL, or Temporal Cloud configuration was supplied. The Docker deployment configuration is prepared but its image build and public deployment are not verified; Docker daemon access was unavailable. Local orchestration used PostgreSQL and Temporal development services on loopback.

The dispatcher crash window before Temporal acknowledgement, credential expiry, upstream throttling, and corrupted-file handling have not all received end-to-end fault injection. The relevant state transitions and artifact checks are implemented; only the two fault experiments above are claimed as tested.
