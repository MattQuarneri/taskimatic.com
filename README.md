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
