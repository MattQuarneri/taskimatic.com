# taskimatic.com
the assets and services served by taskimatic.com

The task app uses browser-native ES modules; no build step or package installation is required.
Serve this directory over HTTP for development (for example, `python3 -m http.server 8765`).

- `index.html`: page metadata, accessible shell, and portable workspace seed.
- `css/tasks.css` and `css/protect-modal.css`: global workspace and Lock In styles.
- `webcomp/`: custom elements, with each component's template, styles, and event handling together. `task-workspace.js` coordinates the workspace and its views.
- `webcomp/plan-item.js`, `goal-item.js`, and `want-item.js`: dedicated planning cards. Each accepts `setData({ record, parents?, children?, associations?, catalog?, goalParents? })` and emits bubbling `planning-*` events. `planning-item.js` shares editing, associations, child links, and deletion behavior.
- `js/tasks-app.js`: startup and component registration after translations are ready.
- `js/task-model.js`: task normalization, shared formatting, and duration caching.
- `js/task-repository.js`: OPFS persistence, IndexedDB migration/fallback, and memory fallback.
- `js/task-analytics.js`: analytics and date windows.
- `js/task-api.js`: the public `window.taskimatic` API.
- `js/portable-app.js`: self-contained HTML exports, including styles, translations, scripts, and workspace data.
- `js/workspace-tabs.js` and `js/offline.js`: page navigation and offline/install setup.

Run checks with `node --test tests/*.test.mjs`.
When adding an app dependency, include it in `tasks-sw.js` and bump the cache version.
Portable exports support static named imports, side-effect imports, and named exports.
Keep that module syntax for app dependencies and run the portable bundle test when changing imports.

The Today panel's `<today-time>` component accepts a `tasks` array and emits
`today-time-change` with `detail.tasks`, priority-ordered copies containing `color`
and `completesAt`. Completed and tabled tasks are excluded. It schedules estimates
from the current time (30 minutes for unestimated tasks), refreshes every minute,
and inserts a break after each 60 minutes of work, splitting long tasks as needed.
The inline break setting defaults to 5 minutes and is saved in browser storage;
0 disables breaks. Task cards accept a `backgroundColor` property for matching colors.

File associations are available on tasks, plans, goals, and wants. Click
**+ association**, choose **file**, then choose **Link** (the default) or **Local**.
Link accepts any absolute URL protocol, including `http:`, `https:`, and `file:`;
the browser handles protocols that cannot be previewed. Local opens a file picker
and stores the bytes in `taskimatic/FileRepo` in OPFS. The association stores a
content-based ID, filename, MIME type, and size. Filename pills open the floating
viewer; Markdown and JavaScript previews use JSONMD.

Under Settings, use **Export files as ZIP** and **Import files from ZIP** to back
up or restore FileRepo. ZIP imports merge files and preserve IDs. FileRepo ZIPs
contain a manifest and file bytes; export workspace JSON separately to preserve
tasks and their associations. Workspace JSON and portable HTML contain file
references, so transfer both backups when moving to another browser or origin.
Archive imports validate sizes, checksums, IDs, and paths before writing. ZIPs
use standard STORE entries and support DEFLATE on import (256 MB archive limit).
The programmatic API is `window.taskimatic.fileRepo` (`put`, `get`, `list`,
`exportZip`, `importZip`). OPFS requires HTTPS or localhost and browser support;
if unavailable, local file loading reports an error rather than silently using
session memory. Existing inline attachments remain readable.

## Agent tools

The app entry point (`index.html` → `js/tasks-app.js`) installs
`window.taskimatic.tools`. It is available after the app module loads. Tool calls
wait for workspace storage to initialize. If loading your agent earlier, listen
for `taskimatic:ready`; for agents injected after startup, check
`window.taskimatic?.tools` first.

```js
const tools = window.taskimatic.tools;

// Each entry has name, description, parameters (JSON Schema), signature
// (the same schema), annotations, and execute(args) => Promise<JSON result>.
LoadTools(tools.forLoadTools());

// Or adapt these serializable definitions to your harness's expected format:
const definitions = tools.list();
const result = await tools.call('createTask', {
    input: { text: 'Document agent integration', today: true }
});
await tools.call('addTaskAssociation', {
    id: result.id,
    association: { type: 'project', value: 'Taskimatic' }
});
await tools.call('updateTask', {
    id: result.id, patch: { notes: 'Tools use the same workspace actions as the UI.' }
});
```

`LoadTools` is supplied by your agent harness; the example assumes it accepts an
array of these entries. Adapt `execute`, `signature`, or the array shape if its
contract differs. All calls take **one argument object**, and failures reject
with an Error. Definitions from `list()` can cross a JSON/message boundary;
functions from `forLoadTools()` stay in the page. Tool results are cloned.

The registry covers create/list/update/delete and add/remove associations for
Tasks, Plans, Goals, and Wants; linked child creation; named agents; task
priorities; human/agent timers; time-entry editing/deletion; analytics; workspace
export/import; and portable app downloads. `list()` is the authoritative catalog
of fields and signatures. Use list tools to obtain IDs. Parent links can be
cleared with null; update patches preserve omitted fields. `createChild` links
want → goal → plan → task; direct links also work through create/update tools.
Association edits affect own associations; planning list results also expose
`effectiveAssociations` derived from children.

`js/task-tools.js` defines schemas, descriptions, and dispatch. Task and planning
entity edit events use this registry, which delegates to the workspace's shared
validation, persistence, rendering, and change notifications. Existing positional
`window.taskimatic` API methods remain compatible. UI-only rendering context is
passed separately from tool arguments. Navigation, presentation settings, and
binary FileRepo operations remain outside the agent catalog; the existing
`taskimatic.fileRepo` API handles file bytes.

Add app-specific tools with `tools.register({ name, description, parameters },
execute)`, then reload the harness's tools. Names must be unique. Built-in schemas
use objects, arrays, required fields, types, enums, minimums, patterns, and string
minimum lengths; those schema constraints are validated before dispatch. Custom
tools should use that same subset or validate further inside `execute`.
`annotations.readOnly` and `annotations.destructive` describe built-in effects
for harness policy; the registry itself does not prompt for approval. It runs in
the page with the same local workspace access as the app.

## Guided planning and starter prompts

The **Guide** button opens a local wizard for Want → Goal → Plan → Task. It
welcomes empty workspaces once per browser, can be reopened at any time, previews
drafts before saving, and carries the saved parent into the next stage. Choosing
**Explore on my own** dismisses it. The four actions can also prepare a prompt
with the selected parent and current draft for an assistant.

The maintained starter templates are in `js/task-guidance.js`: `welcome`,
`conversation`, `clarify-want`, `clarify-goals`, `clarify-plans`, and `detail-tasks`.
Each process has shared planning instructions plus Type, Talk, or Tap guidance.
Type is free-form text; Talk expects the harness's speech and walkie-talkie
features; Tap asks the harness for bounded choices with a custom-answer route.
The app does not supply a model, speech engine, or assistant input renderer.

```js
// Connect the Guide's “Send to assistant” action to your harness.
// Replace beginConversation with your harness's actual entry point.
const disconnect = taskimatic.prompts.connect(request => {
    return beginConversation({
        instructions: request.prompt,
        inputMode: request.mode
    });
});

// Trigger the same process from a harness Tap button.
await taskimatic.prompts.start('clarify-goals', {
    mode: 'tap', parentId: 'existing-want-id'
});

// Open-ended sessions and onboarding use the same planning principles.
const conversation = await taskimatic.prompts.prepare('conversation', {
    mode: 'talk', userInput: 'Help me make sense of what matters this week.'
});
// Load conversation.prompt into your harness; supply the tool registry separately.
// prepare() only returns data. start() hands it to the connected handler.
disconnect();
```

`taskimatic.prompts.list()` returns template IDs and labels; `get(id)` returns
process metadata; `prepare(id, {mode?, parentId?, userInput?})` returns
`{templateId, version, label, mode, context, prompt}`. Defaults are Type mode,
no parent, and empty input. A supplied parent ID is resolved against the expected
collection. Without a parent, the prompt asks the agent to help select one.
Preparing a prompt never mutates workspace records. `connect(handler)` returns
an unsubscribe function; `connected` reports availability. Connection changes
emit `taskimatic:guidance-connection` on document. `start()` rejects when no
handler is connected, and propagates handler errors. Connect the handler after
app startup (`taskimatic:ready`, or check `window.taskimatic` when injected late).

The portable draft skill is
[docs/skills/taskimatic-guide/SKILL.md](docs/skills/taskimatic-guide/SKILL.md).
It routes to these templates rather than duplicating their full text. Starter
prompts and the Guide currently use English; the agent can converse in the user's
language. Dependency instructions match the current picker: `dependent-task`
values use prerequisite task titles, while record IDs identify tool call targets.
Dependencies are descriptive associations, not enforced scheduling constraints.
