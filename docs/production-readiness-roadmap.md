# Production Readiness Roadmap

This is the plan for turning Pactum from "an impressive list of shipped features" into a
product a real user could be pointed at with confidence. It's written from a full audit of
the repo (every package, every CI workflow, every route) done alongside issues
[#230](https://github.com/LynxXProtocol/Pactum/issues/230)–[#235](https://github.com/LynxXProtocol/Pactum/issues/235)
and PR [#236](https://github.com/LynxXProtocol/Pactum/pull/236).

## The one-sentence diagnosis

**Individual features are well-built; the system as a whole has never been verified end-to-end.**
Every gap found this cycle — a dead-stub backend route the frontend has been silently failing
against since it was wired up, a preflight transaction missing 5 of 9 required arguments, two
packages with zero CI ever run against them, contract error codes colliding across parallel PRs —
has the same root cause: a lot of contributors, working in isolation, each verified their own
piece in isolation. Nothing has verified the seams between pieces. That's what this roadmap fixes,
in order.

## How to use this document

Work the phases **in order**. Phase 2 assumes Phase 1 is done. Don't start building new product
surface (Phase 4) while Phase 1/2 gaps are still open — every closed "build X" issue this project
has accumulated (and there are a lot — see the Appendix) is exactly how you get more of the same
problem: another well-built island nothing else has been checked against.

---

## Phase 1 — Close the verification gap (in progress: PR #236)

Nothing here is new work. It's making sure everything already claimed as "done" actually is.

- [x] Audit every package for CI coverage; `evm/` and `packages/cli` had none. Added.
- [x] Run every package's test suite for real, at least once, to find out what "no CI" was
      actually hiding. Found and fixed: a stub `GET /commitments/:id`, an SDK build-order
      dependency nobody had hit, a typo'd field name, an unverified gas-reduction claim.
- [x] Remove confirmed-dead code (`frontend-vanilla/`) rather than let it keep confusing the
      next person who finds it.
- [x] Fix the `.gitignore`/tracked-files mismatches that were making every contract PR's diff
      unreadable.
- [ ] **Add the CI guard from [#232](https://github.com/LynxXProtocol/Pactum/issues/232)** — a
      script that fails CI if two `Error` discriminants or two migration filenames collide. This
      is the one item from this phase not yet done; it's what stops the _next_ round of this
      exact problem instead of just cleaning up the current round.
- [ ] **Extract the shared Soroban client** ([#231](https://github.com/LynxXProtocol/Pactum/issues/231))
      — `soroban.ts` is hand-duplicated 3x and has already drifted once in a way that shipped a
      real bug. Every day this isn't fixed is another day a fix to one copy can silently not
      reach the other two.
- [ ] **Fix the `window.__simConfirm`/`__simCancel` pattern** ([#235](https://github.com/LynxXProtocol/Pactum/issues/235))
      — smaller, but it's exactly the kind of implicit-global state that makes bugs hard to
      reproduce later. Cheap to fix now, more expensive once more code depends on the pattern.

**Exit criteria:** every package in the repo has CI, every CI job is green, no known dead code,
no unresolved "we said this was done but never checked" items.

---

## Phase 2 — Decide what's actually in scope, then prove it works

This project has an unusual amount of built-but-unintegrated ambition: ZK fraud proofs,
homomorphic encryption, optimistic rollup batching, CRDT multi-device sync, an EVM cross-chain
oracle, a full M-of-N attestor staking/voting subsystem. Some of this is genuinely
differentiating. Some of it is speculative work that shipped because an issue existed for it, not
because the product needed it yet. Both of those are fine outcomes — what's not fine is not
knowing which is which.

For each major subsystem, answer one question: **can a real user reach this from the UI today?**

| Subsystem                                 | Reachable from UI?                                                                                  | Action                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Core commitment create/attest/dispute     | Yes                                                                                                 | Keep hardening (Phase 3)                                                                     |
| Attestor staking + M-of-N voting          | **No** (grep confirms zero references — [#233](https://github.com/LynxXProtocol/Pactum/issues/233)) | Decide: build the client surface next, or explicitly mark deferred in `docs/architecture.md` |
| Homomorphic encryption reputation         | Partially — contract + backend exist, check frontend wiring                                         | Audit like #233 did for staking                                                              |
| ZK fraud proofs / optimistic rollup       | Partially — `RollupStatusPanel` exists in demo mode                                                 | Confirm real (non-demo) path is reachable, or mark experimental                              |
| EVM cross-chain oracle                    | No — explicitly a PoC per `evm/README.md`                                                           | Correctly scoped already; just needed CI (done in #236)                                      |
| CRDT / offline sync / service worker mesh | Partially wired (`useSyncCache`)                                                                    | Verify against the same "can a user actually trigger this" bar                               |

Do this exercise for anything not in the table above too. The output isn't code — it's an updated
`docs/architecture.md` that honestly states, for every subsystem, whether it's live product
surface or an experiment, so the next contributor doesn't build against something assuming it's
load-bearing when it isn't (or vice versa).

**Exit criteria:** `docs/architecture.md` has a current, accurate "what's actually live" section.
No subsystem's status is a guess.

---

## Phase 3 — Harden what's actually in scope

Once Phase 2 says what's real product surface, that surface needs the boring reliability work
most of this project has skipped in favor of building the next feature:

- **Integration tests that hit real routes, not just pure helper functions.** `backend/src/routes/commitments.test.ts`
  unit-tests `toApiCommitment`/`encodeCursor` in isolation; nothing exercises `GET /commitments/:id`
  against a real database (the exact route that shipped as a dead stub for however long — the kind
  of bug integration tests exist to catch). `backend/tests/integration/` has a Testcontainers
  pattern already; extend it to cover every route, not just the indexer.
- **A security review pass on the code paths that actually get used** (not the unused staking
  path — see Phase 2). Contract authorization logic, the RPC pooling/failover paths, wallet
  signing flows.
- **Load/soak testing** for the indexer and the RPC connection pool under real traffic patterns,
  not just unit-test-scale.
- **An honest look at test coverage on the frontend beyond unit tests** — 170 passing Vitest
  tests is good, but the bugs found this cycle (preflight simulation, the lookup page) were UI
  wiring bugs unit tests structurally can't catch. The e2e suite is the right tool; make sure it
  covers every user-reachable flow from Phase 2's table, not just the ones that happened to get
  e2e coverage when they were built.

**Exit criteria:** every live subsystem from Phase 2 has integration/e2e coverage that would have
caught the actual bugs found this cycle, not just coverage that exists.

---

## Phase 4 — New product surface

Only after Phase 1–3 are genuinely done. At that point, working through the open backlog
(#8, #9, #42, #52, #63 pending its Phase-2 outcome, #140, #149, #156, #191, #193, #207–213) is
reasonable — but apply the same discipline going forward that this roadmap exists to retrofit:
**a feature isn't done when the contract/route compiles and its own unit tests pass — it's done
when it's reachable from the UI and something (a real e2e test, not a manual click-through) proves
that.** That single standard, applied consistently, is what prevents needing another audit pass
like this one a few months from now.

---

## Appendix: why this document exists

As of this audit, the repo has ~50 closed "feature" issues covering an unusually wide surface for
a project this age — multi-arbitrator voting, ZK proofs, homomorphic encryption, CRDT sync,
optimistic rollups, an EVM bridge, hardware wallet support, service-worker-mesh BFT gossip. That
breadth is genuinely impressive engineering output. It's also exactly how a project ends up with
six figures' worth of dead-stub bugs and unreachable subsystems: closing an issue means "the code
for X exists and its own tests pass," not "X works as part of the product." This roadmap is the
plan for closing that gap once, thoroughly, and then keeping it closed.
