import './jsonmd.js';

/**
 * <floating-file-view> — a draggable, collapsible window that renders one file
 * according to its MIME type: images as images, media in a player, PDFs in a
 * frame, anything textual as its own source, and everything else as a download
 * card. The footer carries the file path as a file:// link.
 *
 * Modelled on <floating-email-viewer>, minus the email-specific stacking.
 *
 *   import { openFloatingFileView } from "../webcomp/floating-file-view.js";
 *   openFloatingFileView({ path: "/Users/me/notes.md", size: 1024 });
 *
 * `url` defaults to the fsinfo file endpoint; pass it explicitly to serve the
 * bytes from somewhere else.
 */

const fileViewRegistry = new Map();
let fileViewZ = 10000;
let fileViewCascade = 0;

function getStoredTheme() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('taskimatic-file-view-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
  } catch {}
  return 'dark';
}

function setStoredTheme(theme) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('taskimatic-file-view-theme', theme);
    }
  } catch {}
}

// Textual content is capped so a multi-gigabyte log cannot take the tab down.
const TEXT_BYTE_LIMIT = 2 * 1024 * 1024;

const EXTENSION_TYPES = {
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.webp':'image/webp', '.bmp':'image/bmp', '.ico':'image/x-icon', '.avif':'image/avif',
  '.pdf':'application/pdf',
  '.mp4':'video/mp4', '.m4v':'video/mp4', '.webm':'video/webm', '.mov':'video/quicktime',
  '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.wav':'audio/wav', '.ogg':'audio/ogg',
  '.flac':'audio/flac', '.aac':'audio/aac', '.svg':'image/svg+xml'
};

const TEXTUAL_EXTENSIONS = new Set([
  '.txt','.md','.markdown','.log','.csv','.tsv','.json','.jsonl','.ndjson',
  '.yaml','.yml','.toml','.ini','.cfg','.conf','.env','.patch','.diff',
  '.js','.mjs','.cjs','.ts','.tsx','.jsx','.css','.scss','.less','.sql',
  '.sh','.bash','.zsh','.fish','.py','.rb','.go','.rs','.c','.h','.cpp',
  '.hpp','.cc','.cs','.java','.kt','.swift','.php','.pl','.lua','.r',
  '.html','.htm','.xhtml','.xml','.svg','.vue','.svelte',
]);

export function fileEndpointUrl(path) {
  return `/fsinfo/file?path=${encodeURIComponent(path)}`;
}

export function fileHref(path) {
  // encodeURI leaves '#' and '?' intact, which would truncate the URL.
  return `file://${String(path || '').split('/').map(encodeURIComponent).join('/')}`;
}

export function extensionOf(name = '') {
  const base = String(name).split('/').pop() || '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i).toLowerCase() : '';
}

export function guessMimeType(name = '') {
  const ext = extensionOf(name);
  if (EXTENSION_TYPES[ext]) return EXTENSION_TYPES[ext];
  if (TEXTUAL_EXTENSIONS.has(ext)) return 'text/plain';
  return 'application/octet-stream';
}

/** Which element should render this type. */
export function renderModeFor(mime = '') {
  const type = String(mime).split(';')[0].trim().toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('text/')) return 'text';
  if (/^application\/(json|xml|javascript|ecmascript|x-sh|x-yaml|yaml|toml|sql)$/.test(type)) return 'text';
  if (/\+(json|xml)$/.test(type)) return 'text';
  return 'binary';
}

export function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function isHtmlFile(file) {
  if (!file) return false;
  const mime = String(file.mime || '').toLowerCase();
  const ext = extensionOf(file.name || file.path);
  return mime.includes('html') || ext === '.html' || ext === '.htm' || ext === '.xhtml';
}

export function isMediaFile(file) {
  if (!file) return false;
  const mode = renderModeFor(file.mime);
  return mode === 'image' || mode === 'video';
}

export function isJavaScriptFile(file) {
  return ['.js', '.mjs', '.cjs', '.jsx'].includes(extensionOf(file?.name || file?.path)) || /javascript|ecmascript/i.test(file?.mime || '');
}

export function isMarkdownFile(file) {
  return ['.md', '.markdown'].includes(extensionOf(file?.name || file?.path)) || /^(text\/(markdown|x-markdown))($|;)/i.test(file?.mime || '');
}

class FloatingFileView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode:'open' });
    this._file = null;
    this._collapsed = false;
    this._maximized = false;
    this._savedState = null;
    this._drag = null;
    this._resize = null;
    this._body = null;       // kept across renders so media/scroll state survives
    this._status = '';
    this._registeredKey = null;
    this._renderHtml = false;
    this._mediaFit = true;
    this._textCache = null;
    this._originalText = null;
    this._truncated = false;
    this._saving = false;
    this._renderMarkdown = true;
    this._theme = getStoredTheme();
    this._beforeUnload = event => {
      if (!this._isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
  }

  connectedCallback() {
    window.addEventListener('beforeunload', this._beforeUnload);
    this.addEventListener('pointerdown', () => this._raise());
    this.shadowRoot.addEventListener('pointerdown', () => this._raise(), { capture: true });
    this.setAttribute('data-theme', this._theme);
    this.setAttribute('data-color-mode', this._theme);
    this._render();
    this._raise();
  }

  disconnectedCallback() {
    window.removeEventListener('beforeunload', this._beforeUnload);
    if (this._ownedUrl) URL.revokeObjectURL(this._ownedUrl);
    this._ownedUrl = null;
    if (this._registeredKey && fileViewRegistry.get(this._registeredKey) === this) {
      fileViewRegistry.delete(this._registeredKey);
    }
  }

  /** { path, url?, name?, mime?, size? } */
  set file(value) {
    if (!value) return;
    if (this._ownedUrl) URL.revokeObjectURL(this._ownedUrl);
    this._ownedUrl = value.ownedUrl ? value.url : null;
    const path = value.path || '';
    this._sourcePath = path;
    this._file = {
      path,
      url: value.url || (path ? fileEndpointUrl(path) : ''),
      name: value.name || (path.split('/').pop() || path || 'file'),
      mime: value.mime || guessMimeType(value.name || path),
      size: Number(value.size) || 0,
    };
    this._body = null;
    this._status = '';
    this._renderHtml = false;
    this._mediaFit = true;
    this._textCache = null;
    this._originalText = null;
    this._truncated = false;
    this._saving = false;
    this._renderMarkdown = true;
    this._registerKey(value.key || path || this._file.url);
    this._render();
  }

  get file() {
    return this._file;
  }

  get isCollapsed() {
    return this._collapsed;
  }

  expand() {
    this._collapsed = false;
    this._render();
    this._raise();
    if (!this._maximized) {
      this._keepInViewport();
    }
  }

  _registerKey(key) {
    if (this._registeredKey && fileViewRegistry.get(this._registeredKey) === this) {
      fileViewRegistry.delete(this._registeredKey);
    }
    this._registeredKey = key || null;
    if (this._registeredKey) fileViewRegistry.set(this._registeredKey, this);
  }

  _render() {
    if (!this.isConnected) return;
    const file = this._file;
    if (!file) return;

    this.classList.toggle('collapsed', this._collapsed);
    this.classList.toggle('maximized', this._maximized);
    this.setAttribute('data-theme', this._theme);
    this.setAttribute('data-color-mode', this._theme);
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      ${this._collapsed ? this._collapsedTemplate(file) : this._windowTemplate(file)}
    `;

    if (!this._collapsed) {
      const slot = this.shadowRoot.querySelector('[data-body-slot]');
      if (slot) slot.appendChild(this._bodyNode());
    }
    this._bind();
  }

  _chromeButtons() {
    return `
      <div class="buttons">
        <button class="save-btn" data-action="save" title="Save a timestamped copy" aria-label="Save a timestamped copy" ${this._isDirty ? '' : 'hidden'} ${this._saving ? 'disabled' : ''}>💾</button>
        <button class="dot close" data-action="close" title="Close" aria-label="Close"></button>
        <button class="dot collapse" data-action="collapse" title="Collapse" aria-label="Collapse"></button>
        <button class="dot expand" data-action="expand" title="${this._maximized ? 'Exit full screen' : 'Full screen'}" aria-label="${this._maximized ? 'Exit full screen' : 'Full screen'}"></button>
      </div>
    `;
  }

  _windowTemplate(file) {
    const mode = renderModeFor(file.mime);
    let modeButton = '';
    if (isMarkdownFile(file) || isJavaScriptFile(file)) {
      modeButton = `<button class="mode-btn" data-action="toggle-markdown">${this._renderMarkdown ? 'Raw / Edit' : 'Preview'}</button>`;
    } else if (isHtmlFile(file)) {
      const label = this._renderHtml ? 'Raw' : 'Render';
      const title = this._renderHtml ? 'Show raw HTML' : 'Render HTML in frame';
      modeButton = `<button class="mode-btn" data-action="toggle-html" title="${title}">${label}</button>`;
    } else if (isMediaFile(file)) {
      const label = this._mediaFit ? 'Actual' : 'Fit';
      const title = this._mediaFit ? 'Show actual size' : 'Fit to viewer';
      modeButton = `<button class="mode-btn" data-action="toggle-media-fit" title="${title}">${label}</button>`;
    }

    return `
      <section class="window" part="window">
        <div class="chrome" data-drag-handle>
          ${this._chromeButtons()}
          <div class="title" title="${this._escape(file.path)}">${this._escape(file.name)}</div>
          <button class="theme-btn" data-action="toggle-theme" title="${this._theme === 'light' ? 'Switch to dark view' : 'Switch to light view'}" aria-label="Toggle light/dark view">
            <svg class="theme-circle" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M 8 1 A 7 7 0 0 1 8 15 Z" fill="#f3efe4"/>
              <path d="M 8 1 A 7 7 0 0 0 8 15 Z" fill="#111722"/>
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </button>
          <div class="kind-group">
            <span class="kind">${this._escape(mode)}</span>
            ${modeButton}
          </div>
        </div>
        <div class="content" data-body-slot></div>
        <footer class="footer">
          ${file.path
            ? `<a class="path" href="${this._escape(fileHref(file.path))}" title="${this._escape(file.path)}">${this._pathTemplate(file.path)}</a>`
            : /^https?:/i.test(file.url)
              ? `<a class="path" href="${this._escape(file.url)}" target="_blank" rel="noopener noreferrer" title="Open original file">${this._escape(file.name)}</a>`
              : `<span class="path">${this._escape(file.name)}</span>`}
          <div class="actions">
            <button class="link-btn" data-action="copy-path" title="Copy path" ${file.path ? '' : 'hidden'}>copy</button>
            <a class="link-btn" href="${this._escape(file.url)}" download="${this._escape(file.name)}" title="Download file">save</a>
          </div>
          <div class="meta">${this._escape(this._metaLine(file))}</div>
        </footer>
        <div class="resize-handle" data-resize-handle title="Resize window"></div>
      </section>
    `;
  }

  _collapsedTemplate(file) {
    return `
      <section class="collapsed-card" data-drag-handle data-action="restore" title="${this._escape(file.path)}">
        ${this._chromeButtons()}
        <div class="mini-title">${this._escape(file.name)}</div>
      </section>
    `;
  }

  /** Directory shrinks and ellipsizes; the filename always stays readable. */
  _pathTemplate(fullPath = '') {
    const idx = String(fullPath).lastIndexOf('/');
    const dir = idx < 0 ? '' : fullPath.slice(0, idx + 1);
    const name = idx < 0 ? fullPath : fullPath.slice(idx + 1);
    return `${dir ? `<span class="path-dir">${this._escape(dir)}</span>` : ''}<span class="path-name">${this._escape(name)}</span>`;
  }

  _metaLine(file) {
    const parts = [String(file.mime).split(';')[0]];
    if (file.size) parts.push(formatBytes(file.size));
    if (this._status) parts.push(this._status);
    return parts.filter(Boolean).join(' · ');
  }

  /** Built once per file so playback position and scroll survive re-renders. */
  _bodyNode() {
    if (this._body) return this._body;
    const file = this._file;
    const mode = isMarkdownFile(file) ? 'text' : renderModeFor(file.mime);

    if (isHtmlFile(file) && this._renderHtml) {
      const frame = document.createElement('iframe');
      frame.className = 'frame';
      frame.title = file.name;
      this._body = frame;
      this._loadHtmlRender(frame);
      return this._body;
    }

    if (mode === 'image') {
      const img = document.createElement('img');
      img.className = `media ${this._mediaFit ? 'fit' : 'actual'}`;
      img.alt = file.name;
      img.src = file.url;
      img.addEventListener('error', () => this._failBody('could not load image'));
      this._body = img;
    } else if (mode === 'video' || mode === 'audio') {
      const media = document.createElement(mode);
      media.className = mode === 'video' ? `media ${this._mediaFit ? 'fit' : 'actual'}` : 'audio';
      media.controls = true;
      media.preload = 'metadata';
      media.src = file.url;
      media.addEventListener('error', () => this._failBody(`could not play ${mode}`));
      this._body = media;
    } else if (mode === 'pdf') {
      const frame = document.createElement('iframe');
      frame.className = 'frame';
      frame.src = file.url;
      frame.title = file.name;
      this._body = frame;
    } else if (mode === 'text') {
      const body = document.createElement('div');
      body.className = 'text-body';
      body.textContent = 'loading…';
      this._body = body;
      if (this._textCache !== null) this._populateText(body);
      else this._loadText(body);
    } else {
      const card = document.createElement('div');
      card.className = 'binary';
      card.innerHTML = `
        <div class="binary-name">${this._escape(file.name)}</div>
        <div class="binary-meta">${this._escape(String(file.mime).split(';')[0])}${file.size ? ` · ${formatBytes(file.size)}` : ''}</div>
        <div class="binary-note">No inline view for this type.</div>
      `;
      this._body = card;
    }
    return this._body;
  }

  _failBody(message) {
    this._status = message;
    const meta = this.shadowRoot.querySelector('.meta');
    if (meta) meta.textContent = this._metaLine(this._file);
  }

  async _loadHtmlRender(frame) {
    try {
      let text = this._textCache;
      if (text === null) {
        const response = await fetch(this._file.url);
        text = await response.text();
        this._textCache = text;
        this._originalText = text;
        this._truncated = new TextEncoder().encode(text).length > TEXT_BYTE_LIMIT;
      }
      const baseHref = this._escape(fileHref(this._file.path) || this._file.url);
      const baseTag = `<base href="${baseHref}">`;
      let html = text;
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, match => `${match}\n${baseTag}`);
      } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html[^>]*>/i, match => `${match}\n<head>${baseTag}</head>`);
      } else {
        html = `<!DOCTYPE html><html><head>${baseTag}</head><body>${html}</body></html>`;
      }
      frame.srcdoc = html;
    } catch (error) {
      frame.srcdoc = `<!DOCTYPE html><html><body style="background:#0b0f16;color:#ff8a8a;font-family:sans-serif;padding:20px;">Could not render HTML.<br>${this._escape(error.message)}</body></html>`;
    }
  }

  get _isDirty() {
    return this._originalText !== null && this._textCache !== this._originalText;
  }

  _updateSaveButton() {
    const button = this.shadowRoot.querySelector('[data-action="save"]');
    if (button) {
      button.hidden = !this._isDirty;
      button.disabled = this._saving;
    }
  }

  _populateText(body) {
    body.replaceChildren();
    if ((isMarkdownFile(this._file) || isJavaScriptFile(this._file)) && this._renderMarkdown) {
      const preview = document.createElement('json-md');
      preview.setAttribute('format', 'markdown');
      preview.setAttribute('data', 'readonly');
      preview.setAttribute('data-color-mode', this._theme || 'dark');
      // A fence longer than any backtick run keeps JavaScript strictly as source.
      let fenceLength = 3;
      for (const match of this._textCache.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
      const fence = '`'.repeat(fenceLength);
      preview.value = isJavaScriptFile(this._file)
        ? `${fence}javascript\n${this._textCache}\n${fence}`
        : this._textCache;
      body.appendChild(preview);
    } else {
      const editor = document.createElement('textarea');
      editor.className = 'text editor';
      editor.setAttribute('aria-label', `Edit ${this._file.name}`);
      editor.spellcheck = false;
      editor.value = this._textCache;
      editor.readOnly = this._truncated || !this._file.path;
      editor.addEventListener('input', () => {
        this._textCache = editor.value;
        this._updateSaveButton();
      });
      body.appendChild(editor);
    }
  }

  async _loadText(body) {
    const file = this._file;
    const loadId = this._textLoadId = Symbol();
    try {
      const response = await fetch(file.url, { headers:{ Range:`bytes=0-${TEXT_BYTE_LIMIT - 1}` } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      let text = await response.text();
      if (file !== this._file || this._textLoadId !== loadId) return;
      const served = response.headers.get('Content-Type');
      if (served) file.mime = served;
      const total = Number(/\/(\d+)$/.exec(response.headers.get('Content-Range') || '')?.[1]) || Number(response.headers.get('Content-Length'));
      if (total) file.size = total;
      this._truncated = total > TEXT_BYTE_LIMIT || new TextEncoder().encode(text).length > TEXT_BYTE_LIMIT;
      if (text.length > TEXT_BYTE_LIMIT) text = text.slice(0, TEXT_BYTE_LIMIT);
      this._textCache = this._originalText = text;
      this._status = this._truncated ? `first ${formatBytes(TEXT_BYTE_LIMIT)} shown · read-only` : '';
      // A mode switch during loading may have replaced the original body.
      this._body = null;
      this._render();
    } catch (error) {
      if (file !== this._file || this._textLoadId !== loadId) return;
      body.classList.add('text', 'error');
      body.textContent = `Could not read this file.\n${error.message}\n${file.path
        ? 'For local paths, a /fsinfo/file service is required. Choose file → Local in Associations to store a browser-accessible copy instead.'
        : 'Open the original file using the link below. The server may not allow previews.'}`;
      this._failBody('read failed');
    }
  }

  async _save() {
    if (!this._isDirty || this._saving || this._truncated || !this._file.path) return;
    const file = this._file;
    const content = this._textCache;
    this._saving = true;
    this._updateSaveButton();
    this._failBody('saving…');
    try {
      const response = await fetch(fileEndpointUrl(this._sourcePath || file.path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Save failed (${response.status})`);
      if (file !== this._file) return;
      this._originalText = content;
      this._file = { ...file, path: result.path, name: result.name, url: fileEndpointUrl(result.path), size: result.size };
      this._registerKey(result.path);
      this._status = 'saved copy';
    } catch (error) {
      if (file === this._file) this._failBody(`save failed: ${error.message}`);
    } finally {
      this._saving = false;
      this._render();
    }
  }

  close() {
    if (this._isDirty && !window.confirm('Discard unsaved changes and close this file?')) return;
    this.remove();
  }

  _toggleTheme() {
    this._theme = this._theme === 'light' ? 'dark' : 'light';
    setStoredTheme(this._theme);
    this.setAttribute('data-theme', this._theme);
    this.setAttribute('data-color-mode', this._theme);
    const button = this.shadowRoot?.querySelector('[data-action="toggle-theme"]');
    if (button) {
      button.title = this._theme === 'light' ? 'Switch to dark view' : 'Switch to light view';
    }
    const preview = this.shadowRoot?.querySelector('json-md');
    if (preview) {
      preview.setAttribute('data-color-mode', this._theme);
    }
  }

  _bind() {
    this.shadowRoot.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', event => {
        const action = el.dataset.action;
        if (action === 'restore' && event.target.closest('button[data-action]')) return;
        event.stopPropagation();
        if (action === 'close') this.close();
        if (action === 'save') this._save();
        if (action === 'toggle-theme') this._toggleTheme();
        if (action === 'toggle-markdown') {
          this._renderMarkdown = !this._renderMarkdown;
          this._body = null;
          this._render();
        }
        if (action === 'collapse') {
          if (this._collapsed) return this.expand();
          this._collapsed = true;
          if (this._maximized) {
            this._maximized = false;
            if (this._savedState) {
              this.style.left = this._savedState.left;
              this.style.top = this._savedState.top;
              this.style.width = this._savedState.width;
              this.style.height = this._savedState.height;
              this._savedState = null;
            }
          }
          this._render();
        }
        if (action === 'expand') {
          if (this._collapsed) {
            this._collapsed = false;
          } else {
            this._maximized = !this._maximized;
            if (this._maximized) {
              if (!this._savedState) {
                this._savedState = {
                  left: this.style.left,
                  top: this.style.top,
                  width: this.style.width,
                  height: this.style.height,
                };
              }
              this.style.left = '';
              this.style.top = '';
              this.style.width = '';
              this.style.height = '';
            } else {
              if (this._savedState) {
                this.style.left = this._savedState.left;
                this.style.top = this._savedState.top;
                this.style.width = this._savedState.width;
                this.style.height = this._savedState.height;
                this._savedState = null;
              }
            }
          }
          this._render();
          this._raise();
          if (!this._maximized) {
            this._keepInViewport();
          }
        }
        if (action === 'restore') this.expand();
        if (action === 'copy-path') {
          navigator.clipboard?.writeText(this._file.path);
          el.textContent = 'copied';
          setTimeout(() => { el.textContent = 'copy'; }, 1200);
        }
        if (action === 'toggle-html') {
          this._renderHtml = !this._renderHtml;
          this._body = null;
          this._render();
        }
        if (action === 'toggle-media-fit') {
          this._mediaFit = !this._mediaFit;
          if (this._body) {
            this._body.className = `media ${this._mediaFit ? 'fit' : 'actual'}`;
          }
          el.textContent = this._mediaFit ? 'Actual' : 'Fit';
          el.title = this._mediaFit ? 'Show actual size' : 'Fit to viewer';
        }
      });
    });

    this.shadowRoot.querySelectorAll('[data-drag-handle]').forEach(handle => {
      handle.addEventListener('pointerdown', event => this._startDrag(event));
    });

    const resizeHandle = this.shadowRoot.querySelector('[data-resize-handle]');
    if (resizeHandle) {
      resizeHandle.addEventListener('pointerdown', event => this._startResize(event));
    }
  }

  _startDrag(event) {
    if (event.button !== 0) return;
    if (this._maximized) return;
    if (event.target.closest('button, a')) return;
    event.preventDefault();
    this._raise();
    const rect = this.getBoundingClientRect();
    this._drag = { x:event.clientX, y:event.clientY, left:rect.left, top:rect.top };
    this.style.left = `${rect.left}px`;
    this.style.top = `${rect.top}px`;
    this.style.right = 'auto';
    this.style.bottom = 'auto';
    this.setPointerCapture(event.pointerId);
    this.addEventListener('pointermove', this._onDragMove);
    this.addEventListener('pointerup', this._onDragEnd);
    this.addEventListener('pointercancel', this._onDragEnd);
  }

  _onDragMove = event => {
    if (!this._drag) return;
    this.style.left = `${this._drag.left + event.clientX - this._drag.x}px`;
    this.style.top = `${this._drag.top + event.clientY - this._drag.y}px`;
  };

  _onDragEnd = event => {
    this.releasePointerCapture?.(event.pointerId);
    this.removeEventListener('pointermove', this._onDragMove);
    this.removeEventListener('pointerup', this._onDragEnd);
    this.removeEventListener('pointercancel', this._onDragEnd);
    this._drag = null;
    this._keepInViewport();
  };

  _startResize(event) {
    if (event.button !== 0) return;
    if (this._maximized || this._collapsed) return;
    event.preventDefault();
    event.stopPropagation();
    this._raise();

    const rect = this.getBoundingClientRect();
    this._resize = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
    };
    this.style.width = `${rect.width}px`;
    this.style.height = `${rect.height}px`;
    this.classList.add('custom-resized');

    this.setPointerCapture(event.pointerId);
    this.addEventListener('pointermove', this._onResizeMove);
    this.addEventListener('pointerup', this._onResizeEnd);
    this.addEventListener('pointercancel', this._onResizeEnd);
  }

  _onResizeMove = event => {
    if (!this._resize) return;
    const newWidth = Math.max(280, Math.min(window.innerWidth - 10, this._resize.startWidth + (event.clientX - this._resize.startX)));
    const newHeight = Math.max(160, Math.min(window.innerHeight - 10, this._resize.startHeight + (event.clientY - this._resize.startY)));
    this.style.width = `${newWidth}px`;
    this.style.height = `${newHeight}px`;
  };

  _onResizeEnd = event => {
    if (this._resize) {
      this.releasePointerCapture?.(event.pointerId);
      this.removeEventListener('pointermove', this._onResizeMove);
      this.removeEventListener('pointerup', this._onResizeEnd);
      this.removeEventListener('pointercancel', this._onResizeEnd);
      this._resize = null;
      this._keepInViewport();
    }
  };

  _raise() {
    this.style.zIndex = String(++fileViewZ);
  }

  _keepInViewport() {
    if (this._maximized) return;
    const rect = this.getBoundingClientRect();
    const margin = 10;
    const left = Math.min(Math.max(rect.left, margin), window.innerWidth - Math.min(rect.width, window.innerWidth) - margin);
    const top = Math.min(Math.max(rect.top, margin), window.innerHeight - Math.min(rect.height, window.innerHeight) - margin);
    this.style.left = `${Math.max(margin, left)}px`;
    this.style.top = `${Math.max(margin, top)}px`;
  }

  _escape(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[char]));
  }

  _styles() {
    return `

      :host {
        --ffv-bg:#111722;
        --ffv-elevated:#0f1520;
        --ffv-border:#2a3347;
        --ffv-text:#d8e2f5;
        --ffv-dim:#8290a8;
        --ffv-accent:#00d4ff;
        --ffv-content-bg:#0b0f16;
        --ffv-content-text:#d8e2f5;
        --ffv-content-dim:#8290a8;
        --ffv-content-border:#2a3347;
        --ffv-content-soft:rgba(255, 255, 255, 0.08);
        --ffv-content-link:#00d4ff;
        display:flex;
        flex-direction:column;
        position:fixed;
        left:70px;
        top:86px;
        pointer-events:auto;
        width:min(720px, calc(100vw - 28px));
        color:var(--ffv-text);
        font-family:'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        filter:drop-shadow(0 18px 36px #00000088);
        user-select:none;
        box-sizing:border-box;
      }
      :host([data-theme="light"]) {
        --ffv-content-bg:#fbf9f4;
        --ffv-content-text:#18242b;
        --ffv-content-dim:#697177;
        --ffv-content-border:#d5cec0;
        --ffv-content-soft:#ede7da;
        --ffv-content-link:#1e5fa0;
      }
      :host(.collapsed) {
        width:260px !important;
        height:auto !important;
      }
      :host(.maximized) {
        left:0 !important;
        top:0 !important;
        width:100vw !important;
        height:100vh !important;
        filter:none;
      }
      .window {
        display:flex;
        flex-direction:column;
        height:100%;
        box-sizing:border-box;
        overflow:hidden;
        border:1px solid var(--ffv-border);
        border-radius:8px;
        background:linear-gradient(180deg, #151c29, var(--ffv-bg));
        box-shadow:0 0 0 1px #ffffff08 inset;
        position:relative;
      }
      :host(.maximized) .window {
        border-radius:0;
        border:0;
      }
      .chrome {
        flex:0 0 auto;
        display:grid;
        grid-template-columns:auto minmax(0, 1fr) auto auto;
        align-items:center;
        gap:10px;
        min-height:34px;
        padding:8px 11px;
        background:var(--ffv-elevated);
        border-bottom:1px solid var(--ffv-border);
        cursor:grab;
      }
      .chrome:active, .collapsed-card:active { cursor:grabbing; }
      .buttons { display:flex; gap:7px; align-items:center; }
      .save-btn { border:0; padding:0 2px; background:transparent; cursor:pointer; font-size:16px; }
      .save-btn[hidden] { display:none; }
      .save-btn:disabled { opacity:.5; cursor:wait; }
      .text-body {
        width:100%;
        align-self:stretch;
        min-height:240px;
        background:var(--ffv-content-bg);
        color:var(--ffv-content-text);
      }
      json-md {
        display:block;
        width:100%;
        color:var(--ffv-content-text) !important;
        --text:var(--ffv-content-text);
        --clr-text:var(--ffv-content-text);
        --bg:var(--ffv-content-bg);
        --clr-base:var(--ffv-content-bg);
        --clr-surface:var(--ffv-content-bg);
        --jmd-bg:var(--ffv-content-bg) !important;
        --jmd-soft:var(--ffv-content-soft) !important;
        --jmd-border:var(--ffv-content-border) !important;
      }
      json-md .jmd-shell {
        border:0 !important;
        border-radius:0 !important;
        background:var(--ffv-content-bg) !important;
      }
      json-md .jmd-body {
        padding:14px 18px;
        color:var(--ffv-content-text) !important;
        font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size:13px;
        line-height:1.6;
        user-select:text;
      }
      json-md .jmd-body h1,
      json-md .jmd-body h2,
      json-md .jmd-body h3,
      json-md .jmd-body h4,
      json-md .jmd-body h5,
      json-md .jmd-body h6 {
        color:var(--ffv-content-text);
        border-bottom-color:var(--ffv-content-border);
      }
      json-md .jmd-body pre {
        background:var(--ffv-content-soft) !important;
        border:1px solid var(--ffv-content-border);
        border-radius:6px;
      }
      json-md .jmd-body code {
        background:var(--ffv-content-soft) !important;
        color:var(--ffv-content-text) !important;
        font-family:'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size:12px;
      }
      json-md .jmd-body pre code {
        background:transparent !important;
        color:inherit !important;
      }
      json-md .jmd-body blockquote {
        border-left:3px solid var(--ffv-content-link) !important;
        color:var(--ffv-content-dim);
      }
      json-md .jmd-body a {
        color:var(--ffv-content-link);
        text-decoration:underline;
        text-underline-offset:2px;
      }
      json-md .jmd-body a:hover {
        filter:brightness(1.2);
      }
      json-md .jmd-body th,
      json-md .jmd-body td {
        border-color:var(--ffv-content-border) !important;
        color:var(--ffv-content-text);
      }
      json-md .jmd-body th {
        background:var(--ffv-content-soft) !important;
      }
      json-md .jmd-body hr {
        border:0;
        border-top:1px solid var(--ffv-content-border);
      }
      .editor {
        display:block;
        min-height:300px;
        height:100%;
        resize:vertical;
        border:0;
        background:transparent;
        color:var(--ffv-content-text);
        font-family:inherit;
        outline-offset:-2px;
      }
      .dot {
        width:12px; height:12px;
        border:0; border-radius:50%;
        cursor:pointer;
      }
      .dot.close { background:#ff5f57; }
      .dot.collapse { background:#ffbd2e; }
      .dot.expand { background:#28c840; }
      .title {
        min-width:0;
        overflow:hidden;
        white-space:nowrap;
        text-overflow:ellipsis;
        font-size:11px;
        font-weight:700;
        letter-spacing:.04em;
      }
      .theme-btn {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        padding:3px 4px;
        border:0;
        background:transparent;
        color:var(--ffv-dim);
        cursor:pointer;
        line-height:1;
        border-radius:4px;
      }
      .theme-btn:hover {
        color:var(--ffv-accent);
      }
      .theme-circle {
        display:block;
        width:14px;
        height:14px;
        flex:0 0 auto;
        transition:transform 0.25s ease;
      }
      .theme-btn:hover .theme-circle {
        transform:scale(1.15);
      }
      :host([data-theme="light"]) .theme-circle {
        transform:rotate(180deg);
      }
      :host([data-theme="light"]) .theme-btn:hover .theme-circle {
        transform:rotate(180deg) scale(1.15);
      }
      .kind-group {
        display:flex;
        align-items:center;
        gap:8px;
      }
      .kind { color:var(--ffv-dim); font-size:10px; white-space:nowrap; }
      .mode-btn {
        padding:2px 7px;
        border:1px solid var(--ffv-border);
        border-radius:4px;
        background:#1a2334;
        color:var(--ffv-accent);
        font:inherit;
        font-size:10px;
        font-weight:600;
        cursor:pointer;
        line-height:1.2;
      }
      .mode-btn:hover {
        border-color:var(--ffv-accent);
        background:#223048;
      }
      .content {
        display:flex;
        justify-content:center;
        align-items:center;
        flex:1 1 auto;
        min-height:0;
        max-height:min(62vh, calc(100vh - 190px));
        overflow:auto;
        background:var(--ffv-content-bg);
        color:var(--ffv-content-text);
        user-select:text;
        box-sizing:border-box;
      }
      :host(.custom-resized) .content,
      :host(.maximized) .content {
        max-height:none;
      }
      .media {
        display:block;
        box-sizing:border-box;
      }
      .media.fit {
        width:100%;
        height:100%;
        max-width:100%;
        max-height:100%;
        object-fit:contain;
      }
      .media.actual {
        width:auto;
        height:auto;
        max-width:none;
        max-height:none;
        object-fit:none;
      }
      .audio { width:100%; margin:18px 12px; }
      .frame { width:100%; height:100%; min-height:200px; border:0; background:#fff; }
      .text {
        width:100%;
        margin:0;
        padding:14px 16px;
        color:var(--ffv-content-text);
        background:var(--ffv-content-bg);
        font-size:12px;
        line-height:1.55;
        white-space:pre;
        tab-size:4;
        box-sizing:border-box;
      }
      .text.error { color:#ff8a8a; white-space:pre-wrap; }
      .binary { padding:28px 20px; text-align:center; width:100%; box-sizing:border-box; }
      .binary-name { font-size:13px; font-weight:700; overflow-wrap:anywhere; }
      .binary-meta { margin-top:6px; color:var(--ffv-dim); font-size:11px; }
      .binary-note { margin-top:14px; color:var(--ffv-dim); font-size:11px; }
      .footer {
        flex:0 0 auto;
        display:grid;
        grid-template-columns:minmax(0, 1fr) auto;
        gap:6px 12px;
        align-items:center;
        padding:8px 11px;
        background:var(--ffv-elevated);
        border-top:1px solid var(--ffv-border);
      }
      .path {
        display:flex;
        min-width:0;
        color:var(--ffv-accent);
        font-size:11px;
        text-decoration:none;
        white-space:nowrap;
        user-select:text;
      }
      .path:hover { text-decoration:underline; }
      .path-dir {
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        color:#7f93b5;
      }
      .path-name { flex:0 0 auto; }
      .actions { display:flex; gap:6px; }
      .link-btn {
        padding:2px 7px;
        border:1px solid var(--ffv-border);
        border-radius:5px;
        background:transparent;
        color:var(--ffv-dim);
        font:inherit;
        font-size:10px;
        text-decoration:none;
        cursor:pointer;
      }
      .link-btn:hover { border-color:var(--ffv-accent); color:var(--ffv-accent); }
      .meta {
        grid-column:1 / -1;
        color:var(--ffv-dim);
        font-size:10px;
      }
      .collapsed-card {
        display:grid;
        grid-template-columns:auto minmax(0, 1fr);
        gap:10px;
        align-items:center;
        min-height:38px;
        padding:9px 11px;
        border:1px solid var(--ffv-border);
        border-radius:8px;
        background:#141b28;
        cursor:grab;
        box-shadow:0 10px 24px #00000077;
      }
      .mini-title {
        overflow:hidden;
        white-space:nowrap;
        text-overflow:ellipsis;
        font-size:11px;
        font-weight:700;
      }
      .resize-handle {
        position:absolute;
        right:0;
        bottom:0;
        width:16px;
        height:16px;
        cursor:nwse-resize;
        z-index:10;
        display:flex;
        align-items:flex-end;
        justify-content:flex-end;
        padding:3px;
        box-sizing:border-box;
      }
      .resize-handle::after {
        content:'';
        width:6px;
        height:6px;
        border-right:2px solid var(--ffv-dim);
        border-bottom:2px solid var(--ffv-dim);
      }
      .resize-handle:hover::after {
        border-color:var(--ffv-accent);
      }
      :host(.collapsed) .resize-handle,
      :host(.maximized) .resize-handle {
        display:none;
      }
    `;
  }
}

if (!customElements.get('floating-file-view')) {
  customElements.define('floating-file-view', FloatingFileView);
}

export { FloatingFileView };

export function openFloatingFileView(descriptor) {
  const file = typeof descriptor === 'string' ? { path:descriptor } : (descriptor || {});
  if (!file.path && !file.url) return null;

  const key = file.key || file.path || file.url;
  const existing = fileViewRegistry.get(key);
  if (existing?.isConnected) {
    existing.expand();
    return existing;
  }

  const viewer = document.createElement('floating-file-view');
  const offset = (fileViewCascade++ % 8) * 28;
  viewer.style.left = `${70 + offset}px`;
  viewer.style.top = `${86 + offset}px`;
  (document.getElementById('viewer-layer') || document.body).appendChild(viewer);
  viewer.file = file;
  return viewer;
}
