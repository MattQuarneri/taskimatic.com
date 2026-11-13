# Taskimatic MVP Alpha Launch Plan

Created: November 6, 2026. Derived from [launch-plan.md](launch-plan.md), which remains the full public-launch plan.

## Goal

Get taskimatic.com live with Meme (the AI assistant) working for a **small, invited alpha cohort** as fast as possible. Alpha is not public launch: we accept known limits, tell testers about them, and gate only on what would lose data, break first run, or misstate what the product does.

**Alpha promise (the only thing we claim):** a local-first task manager where you can talk to Meme to turn a Want into Goals, Plans, and Tasks, review, save, pick Today work, and track time. Manual task management and the Guide work without Meme.

**Explicitly out of the alpha promise:** autonomous task execution, peer sync / WebRTC, offline AI, hosted/paid AI service, multi-device use.

## Current state (from the Nov 6 review)

- Done: core planning/record surface, tool schemas and dispatch, Meme bridge (`js/task-assistant.js`), ordered writes, timer-safe persistence, portable export without remote loader, startup failure reporting, capability inventory. 112/112 automated tests pass.

## Priorities

### P0 — Must be done before sending the alpha link

| # | Work | Done when | Est. |
|---|------|-----------|------|
| 1 | **Commit and push current work.** Review the uncommitted diff, drop `.DS_Store` files (add to `.gitignore`), commit, push to `origin`. | Clean `git status`; tests still 112/112. | 0.5h |
| 2 | **Host the Meme runtime at a public HTTPS URL** with a pinned version path (e.g. `/meme/v0.1.0/meme.js`) and CORS allowing taskimatic.com. Update the `taskimatic-assistant` meta tag and the service-worker cache version. Keep the previous build in place for rollback. | A clean browser on a different network (phone on cellular) loads meme.js and its full dependency graph from taskimatic.com with no console errors. | 0.5–1 day |
| 3 | **Decide and ship one supported AI setup (Q3).** Fastest path: bring-your-own API key for one model, with the tier chosen explicitly. Do not promise hosted or free usage. | A fresh tester can paste a key, complete setup, and reload without losing the connection. | 0.5–1 day |
| 4 | **Live end-to-end Meme check (Type + Tap).** Run: Want → Goal → Plan → Task save, standalone "add a task", ambiguous brainstorm (no save), invalid key, network drop, cancel mid-turn. Fix what breaks. | Records survive reload; Meme reports success only from real tool results; errors are readable; manual use still works when Meme fails. | 1 day |
| 5 | **Data-loss minimum for tabs (Q6).** Cheapest safe option: enforce a single writer. A second tab goes read-only or shows "open in another tab" via the existing `js/workspace-tabs.js`, rather than silently overwriting. | Opening two tabs cannot silently discard an accepted change. | 0.5–1 day |
| 6 | **Backup safety net.** Verify JSON export/import and FileRepo ZIP round trip on a disposable workspace; add a visible "back up your data, browser storage can be cleared" notice at first run. | Export, wipe, restore reproduces records and IDs. | 0.5 day |
| 7 | **Claims and privacy pass (Q4).** One first-use screen: workspace is stored locally; Meme sends the context it needs to the model provider you pick; no content telemetry. Remove or qualify any remaining WebRTC, offline-AI, or hosted-service wording across the page, README, i18n strings, and manifest. | Every public claim matches the alpha promise above. | 0.5 day |
| 8 | **Deploy to taskimatic.com and smoke test.** Confirm hosting target, DNS/HTTPS, service worker registers, update loads a coherent asset set. | Production URL passes items 3, 4, and 6 on desktop Chrome and one phone. | 0.5 day |

**Rough critical path: 4–6 working days**, dominated by items 2–4. Items 1, 5, 6, and 7 can run in parallel with 2–3.

### P1 — Do during the alpha week, not before the link goes out

- **Browser spot-check:** desktop Safari, Firefox, iPhone Safari, Android Chrome. Record version, pass/fail, and narrow the supported list for anything failing, instead of fixing everything.
- **Uncertain-write recovery:** if the OPFS commit succeeds but the IndexedDB copy fails, show a clear degraded-backup state instead of a generic failure.
- **Destructive AI changes (Q5):** for deletes, association replacement, and bulk reprioritization, have Meme state exactly what it will change and get one confirmation. Do not re-ask for approval already given.
- **Planning scenario set:** ~10 saved conversations (ambiguous request, duplicate titles, parent choice, partial failure, prompt injection inside a record) to rerun on each prompt or model change.
- **Meme status UI:** clear connected / busy / failed states, with a cancel button.
- **Feedback route:** a mailto or form link in-app, and one named owner who reads it.
- **Basic accessibility:** keyboard and screen-reader pass on capture, the Meme panel, and dialogs.

### P2 — After alpha, driven by what testers hit

Undo/action history, durable dependency IDs, flexible estimates, scoped record queries, combined JSON+files backup, Talk (voice), multi-device sync, autonomous execution (needs its own run/cancel/completion contract), hosted AI with pricing, translations of Guide content.

## Alpha scope decisions (defaults I recommend; change any you disagree with)

| ID | Decision | Alpha default |
|----|----------|---------------|
| Q1 | Planner or autonomous worker? | Planner only. |
| Q2 | Meme runtime URL and owner | Public HTTPS, pinned version path, you own rollback. |
| Q3 | Supported AI setup | Bring-your-own key, one model, explicit tier. |
| Q6 | Multi-tab and multi-device | Single writer. Multi-device not supported. |
| Q7 | Portable HTML export | Ships without Meme; exported copy says so. |
| Q10 | Languages and voice | English only; Talk labeled unavailable unless verified. |
| Q11 | Cohort and feedback | 5–15 invited testers, opt-in feedback, no content telemetry. |

## Alpha success criteria

- At least 80% of testers get from an intention to a saved, actionable task via Meme in their first session.
- Zero reports of lost data, or every loss traced to a fixed cause.
- Testers can restore from their own backup.
- Fewer than 3 first-run blockers (assistant won't load, key setup fails, wrong claims) across the cohort.

## Suggested sequence

1. **Day 1:** items 1 and 2 (commit, host Meme publicly). Start 7 (claims) alongside.
2. **Day 2:** item 3 (AI setup), then item 4 (live Meme flows). Start 5 (single writer) and 6 (backup) alongside.
3. **Day 3–4:** fix what item 4 exposed, then item 8 (deploy and smoke test) and a rollback rehearsal.
4. **Day 5:** invite the first 3–5 testers with backup instructions and known limits. Widen to the full cohort after 48 hours with no data-loss reports.
5. **Alpha week:** work the P1 list in order of what testers actually hit.

## Alpha launch gate

- [ ] Changes committed and pushed; full automated suite passes.
- [ ] Meme runtime loads from a public HTTPS URL on a clean network, with rollback copy in place.
- [ ] A real model completes the Type and Tap flows through the registered tools; failure states leave manual use intact.
- [ ] Two tabs cannot silently overwrite each other.
- [ ] JSON and ZIP backup/restore verified; first-run backup notice shown.
- [ ] Page, README, and first-use text match the alpha promise, including the remote-AI data flow.
- [ ] Production smoke test passes on desktop and phone.
- [ ] A named owner, feedback route, and rollback procedure recorded.

## What I need from you to move fastest

1. Where does the Meme runtime live today, and can it be served from taskimatic.com or a public subdomain?
2. Which model and provider for alpha, and is bring-your-own-key acceptable?
3. How does taskimatic.com deploy now (GitHub Pages, Netlify, other)?
