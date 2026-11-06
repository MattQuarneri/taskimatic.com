# Taskimatic launch plan

Updated: November 6, 2026 (America/Los_Angeles).

Status: clear code fixes implemented and automated checks passing; public launch remains gated on the work below. This plan is a proposal, not a claim that browser, model, deployment, or user acceptance checks have passed.

## Proposed first release

Launch Taskimatic as a local-first task manager and AI planning assistant. A user can capture work directly or turn a Want into Goals, Plans, and Tasks with an assistant, review the result, save it, choose Today work, and track time. Existing authorization should carry through the requested changes without repeated approval prompts.

Named agents and agent instructions currently describe assignments. They do not establish an autonomous executor. Keep autonomous task execution, local-machine access, peer synchronization, and a hosted paid AI service out of the first-release promise until their implementations and operating model are verified.

Manual task management and the local Guide must remain useful when the assistant is unavailable. Describe offline support separately for task management, installed copies, portable HTML, attachments, and AI.

## Capability review — November 6

Reviewed the page/startup, tool schemas/dispatch, maintained guidance and Meme bridge, public API, local Guide, workspace mutations, repository persistence, file APIs, analytics, Today scheduling, portable export, and offline shell. The code provides the core planning and record-management surface. It does **not** yet provide everything required for a verified public launch or autonomous execution; the release gates below remain open.

The assistant's referenceable CODE (Cognitive Operations Driving Execution) / FILES (Formalized Into Logical Encodings) inventory is now maintained in `js/task-guidance.js:taskCapabilityReport`. `js/task-assistant.js:describeTaskAssistant` adds the actual bridge's registration, effects, connection, and lifecycle boundaries. The inventory distinguishes callable tools, app-only APIs/UI, limitations, and a prioritized wishlist with proposed contracts, benefits, source references, and acceptance criteria. It covers every built-in tool; registered extensions are identified without assuming what they can do.

Read it through `taskimatic.tools.call('getCapabilities', {})`, `taskimatic.getCapabilities()`, or `taskimatic.prompts.capabilities()`. The last route does not require workspace storage or a connected model. All model tiers now receive the boundary and discovery instructions; the adapter and prepared Guide prompts use the same source. Removed unused legacy prompts containing obsolete tool names, pricing, and entirely-local AI claims. Corrected page metadata/structured data/noscript claims about offline AI and WebRTC; this does not constitute a complete audit of translated UI or the external runtime. The loader still uses the existing LAN URL. The external meaning of `meme.tracking = true`, provider data handling, and production readiness remain unverified.

The wishlist includes runtime/provider status, conflict and commit recovery, provider data controls, bounded execution/cancellation, previews/undo/history, scoped research and file extraction, calendars/reminders, external-action connectors, durable dependencies/subtasks, bounded queries/UI tools, and sync/combined backup. These are proposed capabilities, not newly installed tools. Verification and operating-policy work cannot be solved by tool availability alone.

Verification for this review: `node --test tests/*.test.mjs` passes **112/112** tests, including capability/catalog coverage, isolated read-only discovery, unavailable-tool handling, extension classification, all-tier prompt integration, adapter forwarding, and the portable bundle. No live browser/model/provider or public-deployment pass is claimed. Changes remain uncommitted.

## Clear fixes completed in this pass

The delegated patch was recovered after the agent hit a usage limit. The parent agent reviewed it, completed verification, and updated two outdated test expectations without changing the existing file-label or font-size design.

| Change | Implementation and evidence |
| --- | --- |
| Executable assistant startup | JSON-LD contains valid JSON. The app installs `window.initMeme` before appending the optional Meme loader; configuration lives in the page head. |
| Real Meme tool and Guide adapter | `js/task-assistant.js` adapts the validated catalog to `handler`/`inputSchema`, declares read effects as `none` and writes as `unsafe`, connects prepared Guide requests, and forwards Type/Talk/Tap without starting microphone capture. |
| Maintained planning instructions | Assistant system guidance, Tap actions, and the registered `intro` prompt use maintained templates; obsolete tool names and stale service/privacy scripts were removed. |
| Ordered workspace writes | Public UI/API/tool mutations use one queue per workspace. Read APIs wait for pending writes. Independent field edits and incremental associations are covered by regression checks. |
| Validation before timer changes | A rejected completion with an invalid parent leaves timers/history unchanged. The queue remains usable after rejection. |
| Timer/session persistence | Updates use copied records and publish memory after save success. Completion with priority changes and human-timer switching use one `putMany` batch. Synchronous errors abort IndexedDB batches. |
| Portable/offline boundary | Portable exports omit the remote companion loader, configuration, and mounted UI, while retaining local planning and tools. They no longer fetch or inline that loader. The service-worker shell includes the adapter and its cache version was bumped. |
| Startup failure reporting | Workspace initialization failures reject readiness and surface a storage/error state instead of leaving callers waiting indefinitely. |

Verification: `node --test tests/*.test.mjs` passes **109/109** tests with no failures or cancellations. A separate contract check against the real shared `MemeAPI` passes tool registration/dispatch/schema validation, effect declarations, registered intro execution, Guide request/mode forwarding, and disconnect. Browser/model surfaces were mocked in that contract check; no live provider, speech, browser, or public-deployment verification is claimed.

The user's staged wording change in `data/i18n/en.json` was preserved. Changes are left uncommitted for review. The existing LAN runtime URL is preserved pending Q2; it is not established as production-ready by these checks.

## Remaining release work

| Priority | Work | Completion evidence |
| --- | --- | --- |
| P0 | Publish the intended assistant runtime at a reachable, versioned production URL; decide how updates are pinned or rolled back. | A clean browser outside the development LAN loads the complete Meme dependency graph over HTTPS, completes setup, and can recover from an unavailable runtime. |
| P0 | Verify the actual assistant connection, including first run, reload, reconnect, model configuration, cancellation, and errors. | Type and Tap flows complete against a supported real model using the registered Taskimatic tools. Talk is verified separately if offered at launch. |
| P0 | Resolve multi-tab editing and persistence failure boundaries. | Same-record and cross-record edits in two tabs cannot silently discard accepted changes; deletion/import cannot overwrite another tab's newer workspace. A stale writer is reconciled or visibly refused. |
| P0 | Define recovery after an uncertain write result and after the primary OPFS commit succeeds but its IndexedDB recovery copy fails. | Fault-injection checks and reload checks establish which state is durable; the UI/assistant can reconcile without duplicating records or falsely reporting that nothing changed. |
| P0 | Align product, metadata, onboarding, and privacy claims with the release. | Remove or qualify unverified WebRTC, offline AI, hosted-service, and entirely-local-processing claims. Explain what a selected remote model or speech provider receives. |
| P0 | Complete the browser and backup acceptance checks below. | A recorded pass/fail matrix with browser versions, device, runtime revision, model, date, and any excluded features. |
| P1 | Decide how destructive or large AI changes are reviewed and recovered. | The chosen policy is implemented and tested for deletion, association replacement, bulk reprioritization, and import replace. Existing approval is reused within its scope. |
| P1 | Exercise planning quality with real conversations and representative models. | A small maintained scenario set covers ambiguous requests, standalone tasks, duplicate titles, parent choice, partial failure, prompt injection in records, unsupported estimates, and completion reporting. |
| P1 | Improve assistant feedback and troubleshooting. | Clear connected/busy/failed states, useful errors, bounded execution and cancellation, and an opt-in redacted diagnostic path that avoids task text and credentials by default. |
| P1 | Confirm accessibility, phone usability, and supported languages. | Keyboard/screen-reader and mobile checks pass for capture, Guide, assistant, timers, import/export, dialogs, and focus restoration. English-only guidance is identified if it remains. |
| P2 | Add enhancements informed by beta use. | Candidate work: an undo/action history, more efficient scoped record queries, durable dependency IDs, more flexible estimates, and improved Today planning. Choose based on observed user friction. |

P0 blocks a public launch. Resolve each P1 item or explicitly record its deferral and the supported launch behavior. P2 is a candidate backlog.

### Persistence boundaries to resolve

Serialization inside one workspace does not by itself coordinate separate tabs. Web Locks serialize physical writes, but writing a whole stale record or replacing an old snapshot can still overwrite newer information. Decide between revision/conflict checks with reloading, patching against current durable state, or an explicitly enforced single-writer experience. A documented limitation alone should not permit silent data loss.

Likewise, copied timer state protects the interface when a write fails before commit, but an error after a durable commit needs a different response. Prefer an explicit reconciliation or degraded-backup state over an ambiguous generic save failure. Test reload behavior as well as returned promises.

For retries, distinguish a definite refusal before writing from an unknown outcome. Read back and reconcile after unknown outcomes. Choose whether create/import operations need durable request IDs or another deduplication mechanism; do not label writes idempotent unless repeating them is actually safe.

### Assistant behavior to verify

Use the maintained planning templates as the source for conversation, Guide requests, Tap actions, and onboarding. Choose a model tier explicitly until there is a tested capability-based alternative. A tier name is not evidence that a model can reliably call the tools.

Verify that the bridge assigns runtime effect classes honestly and retains schema validation. The shared harness has effect declarations, policies, cancellation, and recovery facilities, but Taskimatic must connect and test the facilities it depends on. Tool annotations and prompt instructions alone do not implement authorization or undo.

Keep task text, prompts, notes, attachments, and tool results as reference data. Acceptance of a planning proposal authorizes the agreed record changes; it does not authorize performing the underlying task, sending messages, accessing local files, or marking the work complete.

## Acceptance checklist

Use a disposable workspace with a known JSON and FileRepo ZIP backup. Keep credentials and personal task data out of test artifacts.

| Scenario | Required result |
| --- | --- |
| Fresh browser, first visit | Workspace and Guide initialize; assistant availability is accurate; no unrequested demo records are created, and provider requests respect the configured setup/consent behavior. Decide whether the welcome runs once or on every load. |
| Save a linked hierarchy | Want → Goal → Plan → Task uses returned IDs; records survive reload; the assistant reports success only from actual results. |
| Start with a standalone task | A direct add request saves the requested task without forcing a hierarchy or asking for the same approval again. |
| Ambiguous or exploratory conversation | The assistant asks a useful bounded question or offers an unsaved draft; it does not manufacture commitments or save merely because the user brainstorms. |
| Overlapping edits | UI and agent changes preserve independent fields; two tabs produce a coherent result or an explicit conflict. |
| Invalid update on a running task | Validation failure leaves the task, active timers, and time history unchanged. |
| Storage failure and uncertain commit | Failures before commit preserve visible state; failures after commit identify/reconcile the actual durable outcome; retries do not duplicate work. |
| Assistant unavailable, invalid key, network error, interrupted turn | Manual work remains usable; errors and connection state are clear; cancellation stops ongoing work and prevents unintended subsequent writes. |
| Type, Tap, and optional Talk | Selected process, input mode, context, and tool schema reach the actual supported model; answers and saved results stay consistent. |
| Untrusted record content | Embedded instructions cannot authorize deletion, external actions, credential access, or executing a task during planning. |
| Backup, restore, and portable download | JSON restores records; FileRepo ZIP restores bytes and IDs; exported HTML works under its documented storage/offline limits. Missing attachment bytes are clearly identified. |
| Offline and reconnect | Installed app reloads after a prior online visit; core data remains editable; assistant limitations are explained without blocking local use. |
| App update | Service-worker update loads a coherent asset revision and preserves workspace data; rollback behavior is known. |
| Phone and accessibility | Capture, dialogs, choices, timers, and backup controls work with touch, keyboard, zoom, and a screen reader. |

Proposed browser coverage: current Chrome/Edge, Firefox, Safari on macOS, Safari on iPhone/iPad, and Chrome on Android. This is a proposed support matrix; record actual versions and results, and narrow public support explicitly if needed. Include OPFS, IndexedDB fallback, and session-only mode where applicable. Portable file-origin persistence must be measured rather than assumed.

## Open questions and proposed defaults

These are product/operating decisions for the owner. Proposed defaults are not settled commitments.

| ID | Question | Proposed default / consequence |
| --- | --- | --- |
| Q1 | Is launch an AI planning assistant or an autonomous worker? | Launch planning and task management first. Execution needs a separate task-to-run dispatch contract, allowed capabilities, progress/results, cancellation, recovery, and completion evidence. |
| Q2 | What is the public Meme runtime URL, version policy, and owner? | Use a reachable HTTPS runtime with a tested revision and a known rollback path. Confirm cross-origin module access and failure behavior outside the LAN. |
| Q3 | Which AI setup is actually supported: user-supplied credentials, in-browser models, hosted service, or a subset? Which exact model configurations pass? | Publish only verified paths. Keep model/tier selection explicit; do not promise hosted pricing, free usage, or offline AI before those paths exist. |
| Q4 | What data may reach model/speech providers, and how are keys and diagnostic logs handled? | State that workspace storage is local while remote AI processes the supplied context. Show provider/data flow before first use, minimize context, and avoid unsolicited task-content telemetry. Verify storage and retention details before claiming them. |
| Q5 | Which destructive/bulk changes may AI perform, and what recovery exists? | Honor explicit scoped requests. Decide whether high-impact changes require a concrete preview and whether launch needs an undo log, restore point, or narrower tool availability. Do not repeat approval already given for the same action. |
| Q6 | Must simultaneous tabs or devices be supported at launch? | Resolve cross-tab data integrity regardless. Defer multi-device/peer synchronization unless implemented and tested; remove current promises if deferred. |
| Q7 | Is an assistant-free portable HTML export acceptable? | Favor a complete usable local workspace over a hidden dependency on a remote loader. Explain the AI limitation in the exported copy and verify how it is presented. |
| Q8 | What backup/retention experience is sufficient for local-only data? | Explain that browser storage can be cleared and that records and FileRepo bytes need coordinated backups. Decide whether one combined backup should be a launch requirement. |
| Q9 | Are title-based dependencies and fixed 10/30/60/90-minute estimates sufficient? | Document current behavior for beta. Dependencies are descriptive, can become ambiguous after renaming, and do not block execution; stable IDs and scheduling enforcement need separate work. |
| Q10 | Which devices/languages and voice features are supported on day one? | Choose a tested subset. Identify English-only Guide content and verify assistant language handling; label Talk unavailable if speech has not been integrated and tested. |
| Q11 | Who owns beta feedback, release approval, runtime costs, and support? How will success be measured without default content telemetry? | Use opt-in feedback and a small beta cohort. Measure whether people can turn an intention into a saved actionable task, resume work, and recover their data. Set numerical targets and budget limits before rollout. |

## Rollout sequence

1. Finish code review, run the full automated suite, and record the exact app/runtime revisions and results.
2. Resolve Q1–Q8 sufficiently to make the first-release behavior and claims accurate; implement the P0 work and any P1 requirements chosen for launch.
3. Run the acceptance checklist in real browsers against the production-intended runtime and supported model configurations. Keep failed or unrun checks visible.
4. Invite a small beta cohort with backup instructions, known limits, and a feedback route. Correct issues that prevent first-use success, lose data, or misstate saved results.
5. Approve public launch only after the gates below pass. Record the release and rollback assets and the person responsible for triage.

No calendar dates are committed until the open decisions and browser/model work are sized.

## Public launch gates

- [ ] Delegated fixes reviewed and full automated checks pass; any remaining failure has a documented resolution.
- [ ] Production runtime and supported AI configuration complete a real first-run planning/save/reload flow.
- [ ] Concurrent editing and storage/commit failures have verified recovery behavior.
- [ ] JSON, FileRepo ZIP, and portable backup/restore checks pass under documented limits.
- [ ] Offline, service-worker update, phone, and accessibility checks pass for the declared support matrix.
- [ ] Product and privacy claims match implemented behavior, including remote AI, peer sync, and autonomous execution.
- [ ] Destructive-action/recovery policy, beta support owner, release revision, and rollback procedure are recorded.
