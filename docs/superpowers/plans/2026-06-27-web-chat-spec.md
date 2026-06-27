# Build-to SPEC — Full-Featured Web Chat for the Agentic-Android Hub

> **STATUS: BUILT + VERIFIED (2026-06-27).** All phases P1–P6 implemented; typecheck clean, 78/78 tests
> (incl. new `test/web-chat.test.ts` for `/ask-async`, `/sessions/*`, `/upload`, `/stream`), and live
> headless-Chrome/CDP verification of markdown, syntax-highlighted code + copy, tables, mermaid (with
> labels), images, file chips + download, live SSE receive, non-blocking send, thinking indicator,
> sessions sidebar, slash menu, file upload, XSS sanitization, mobile drawer — 0 console errors.
> Client: `backbone/public/chat.js` + `chat.css`; vendored UMD libs in `backbone/public/vendor/`.

## 0. Vision + the exact gap we're closing

**Vision.** Replace the bare MVP `/chat` page with a mature, browser-native chat client that is a true peer of the phone app: it observes the hub's live event stream, renders rich content (markdown, syntax-highlighted code, tables, mermaid, images, file chips), drives the hub's shared multi-session store, and offers the polish bar of a modern chat UI (slash menu, drag/drop files, thinking/streaming/stop, autoscroll, keyboard, accessibility) — all with **no build step, no bundler, no React**, staying inside the existing tsx + server-rendered-template-literal model (`backbone/src/panel.ts`).

**The current `/chat` is a hand-rolled MVP** (`CHAT_BODY`/`CHAT_CSS`, panel.ts:299–417). Its exact shortcomings, named:

1. **Blocking send.** `send()` POSTs `/say` (panel.ts:402) which on the server (panel.ts:1896–1913) *blocks up to 60s* waiting for `pendingSay` to fire. One global `pendingSay` callback (panel.ts:1175, set at 1906, consumed at 1544) → only one in-flight message hub-wide; a second sender clobbers the first.
2. **No live event subscription.** The page never sees the hub's live bus. The agent's reply only reaches the browser as the single resolved string from `/say`. Streaming `agent_status` (thinking/ready), out-of-band `assistant_message`, roster changes, and session changes (all emitted via `bus.event(...)` at 1527/1531/1540/1574/1575) are invisible to the browser. The phone gets all of these over the relay; the browser gets none.
3. **No rich rendering.** `add(cls,text)` (panel.ts:347) does `textContent` only. `parts` (markdown/code/table/image/file) returned in turn history and `assistant_message` are dropped on the floor. No markdown, no code highlighting, no copy buttons, no tables, no mermaid, no images, no file chips.
4. **No sessions UI.** The hub owns a full multi-session store (panel.ts:103–157) but exposes session CRUD **only over the relay to the phone** (panel.ts:1609–1623). The browser has no sidebar, no new/select/delete/rename, no history hydration. Refreshing the page loses all context.
5. **No slash menu.** The agent publishes a slash catalog (`agentCommands`, panel.ts:1530) but the browser has no `/`-triggered palette. Phone-only (MainActivity.kt).
6. **No files.** No drag/drop, paste, picker, upload, chips, or download. `/blob/:id` exists (panel.ts:1870) but is hardcoded `image/jpeg` (1872) and the browser never references it.
7. **No thinking indicator beyond a static `…`**, no stop button, no regenerate, no error+retry, no autoscroll affordance, no empty/loading/error states, no per-message actions, no keyboard map beyond Enter/Shift+Enter.

**What we KEEP** (do not rebuild): the agent dropdown + Regular|Orchestrator segmented control and its `ensureSeat()` orchestration plumbing (panel.ts:324–414), the shared session store (panel.ts:74–157), the agent WebSocket + verifier + delegator, the `MsgPart` wire type (parts.ts), `/blob`, `/status`, `/catalog`, `/agent/*`, and the already-vendored libraries under `backbone/public/`.

---

## 1. Feature list (concrete)

### Phone-parity items
- **Live assistant messages with `parts`** — render text + `MsgPart[]` (markdown/code/table/image/file) exactly as the phone's `PartView` does (MainActivity.kt:1007), from the same wire shape (parts.ts:11–16).
- **Live thinking/ready state** — driven by `agent_status` `{label?, ready?, command?}` (emitted panel.ts:1527), shown as an animated thinking row with the agent's label (e.g. "Running tools…", the auth command).
- **Shared multi-session store** — sidebar backed by the same `sessions[]`/`sessionFilePath` store the phone uses (panel.ts:80–157). New/select/delete + history replay mirror the phone's `new_session`/`select_session`/`delete_session` flow (panel.ts:1609–1623).
- **Slash-command menu** — palette populated from the agent's published catalog (`agentCommands`, panel.ts:1530); same `SlashCommand` shape `{invoke, description, hint?, kind, group}` the phone renders.
- **File send + inline media** — attach files (chip), send to the active agent, render returned image/file parts inline with download — mirrors the phone's upload chip + `FilePart`/`AgentImage` (MainActivity.kt:1121/1354).
- **Keep agent dropdown + Regular|Orchestrator mode** — fold the existing seat picker (panel.ts:324–414) into the new shell unchanged.

### Mature-chat bar
- Persistent **sessions sidebar**: new chat, rename, delete, search across titles; collapses on mobile.
- **Streaming-aware** assistant rendering with a visible **thinking indicator** (animated, shows `agent_status.label`).
- **Stop generation** button during an in-flight turn + **regenerate last response**.
- **Slash menu** with fuzzy prefix filter and keyboard navigation (↑/↓/Enter/Esc).
- **File uploads** via drag-drop, paste, and picker; progress + chips; download on received files.
- **Code blocks**: language label, syntax highlighting (highlight.js), copy button.
- **Markdown**: headings, bold/italic, lists, blockquotes, links (clickable), line breaks, tables — all sanitized.
- **Smart autoscroll**: pin-to-bottom; "jump to latest" button appears when scrolled up; resumes on new content only if already pinned.
- **Full keyboard support**: Enter send, Shift+Enter newline, `/` opens commands, Esc closes popups/cancels, ⌘/Ctrl+K session search, ⌘/Ctrl+Backspace stop.
- **States**: empty ("Start a conversation"), loading skeleton on hydrate, error bubble with **Retry**, per-message **copy** + timestamp, user-message **edit→resend**.
- **Responsive**: single column (mobile, drawer sidebar) → sidebar + thread (tablet/desktop).
- **Accessible**: ARIA roles/labels, visible focus, focus trap in modals, WCAG-AA contrast (reuse the dark token palette in `shellDoc`, panel.ts:280).
- **Persistence/restore**: refresh re-hydrates the active session from the hub (history endpoint), never loses context.
- **Clear user vs assistant** distinction (alignment + surface + avatar), reusing existing `.msg.user`/`.msg.bot` styling as a base.

### Nice-to-have (render pipeline already affords these cheaply)
- Mermaid diagrams (mermaid.min.js already vendored), zebra-striped tables, image lightbox + download, math via KaTeX (add later), export session as Markdown/JSON.

---

## 2. Architecture (no-build)

**Stay in the existing model.** The page is server-rendered from a template literal in `panel.ts` via `shellDoc(active, title, body, css)` (panel.ts:276–294). The new chat is `shellDoc("/chat", "Chat", CHAT_BODY_V2, CHAT_CSS_V2)` returned from the existing `GET /chat` route (panel.ts:1689). All client logic is a single inline `<script>` (vanilla ES, IIFE) — same pattern as today (panel.ts:341–417). No imports, no JSX, no bundler.

**Live receive = SSE (the missing piece).** The findings confirm there is **no SSE today**; `bus.event(topic,data)` (the relay emit at panel.ts:1527/1531/1540/1574/1575) and `logEvent()` (panel.ts:66) are the in-process fan-out points, but the browser can't see them. We add **one** server-sent-events endpoint, `GET /stream`, that registers the response object in an in-memory `sseClients` set and replays every hub-side event to it. We tap it by wrapping the existing emit sites (a small `emitLive(topic, data)` helper called alongside `bus.event(...)`), so the browser mirrors what the phone receives over the relay — without the browser needing relay identity/keypair (the documented blocker for browser-on-relay). SSE is chosen over WebSocket because it is one-directional (hub→browser, exactly our need), survives proxies, auto-reconnects natively (`EventSource`), and needs zero handshake — no library.

**Non-blocking send.** Replace the blocking `/say` path for the browser with `POST /ask-async`: it `addTurn("user", …)`, forwards `{t:"user", text, files?}` to `agentSock` (same frame the phone path builds, panel.ts:1646/1907), and **returns immediately** `{ ok, turnId }`. The reply arrives later as an `assistant_message` SSE event (correlated by the active session) and is rendered by the live loop — no `pendingSay` clobbering, multiple sessions safe. `/say` stays for backward-compat/tests; the browser stops using it.

**Vendored render libs from a static route.** A new `GET /public/*` route streams files from `backbone/public/` (where `marked.min.js`, `highlight.min.js`, `purify.min.js`, `mermaid.min.js`, `github-dark.min.css` already live). The chat HTML `<script src="/public/...">`-loads these UMD bundles; they attach globals (`window.marked`, `window.hljs`, `window.DOMPurify`, `window.mermaid`). No CDN → works offline on the tailnet.

**Reuses the phone's backend wholesale.** Sessions come from the same `sessions[]` + `sessionFilePath` store (panel.ts:80–157, 103/110/116/141/155). History uses the same in-memory `conversation` + `histMsgs()` shape (panel.ts:1573). The agent transport (`agentSock`, the `event` handler at panel.ts:1522–1546) is untouched — the browser is just a second observer of the same `bus.event` stream the phone consumes, and a second producer onto the same `agentSock`.

```
          ┌────────── hub (panel.ts, one process) ──────────┐
agent ⇄ WS │  agent "event" handler (1522)                   │
:8124      │     ├─ bus.event(topic,data) ──► relay ──► PHONE │
           │     └─ emitLive(topic,data) ──► SSE set ──► BROWSER (EventSource /stream)
           │  session store (80–157)  ◄── /sessions/* (new) ── BROWSER
           │  agentSock.send({t:user}) ◄── /ask-async (new) ── BROWSER
           │  GET /public/*  (new, static)            ────────► BROWSER (vendored libs)
           └─────────────────────────────────────────────────┘
```

---

## 3. Backend work — exact endpoints

> Convention: each line is **METHOD path — purpose — (reuses X | new)** with real `panel.ts` anchors. Routes slot into the `http.createServer` switch before the 404 tail at **panel.ts:2015**. JSON helper `json()` is at panel.ts:1681.

### Already exists — DO NOT rebuild
- `GET /chat` — serves the page (will return the new `shellDoc` body). panel.ts:1689.
- `GET /status` — roster + active agent + ready state; the seat picker already uses it. panel.ts:1699–1726.
- `GET /catalog` — phone capability list. panel.ts:1869.
- `GET /blob/:id` — blob bytes (needs content-type fix, below). panel.ts:1870.
- `POST /agent/select`, `POST /agent/start`, `POST /agent/stop` — seat binding/orchestrator spawn; keep as-is. panel.ts:1749/1773/1791.
- `POST /say` — blocking; keep for tests/back-compat, browser stops using it. panel.ts:1896.
- `GET /events` — LogEvent polling; keep as a debug/replay fallback, not the live path. panel.ts:1860.
- Session store functions `newSession`/`selectSession`/`deleteSession`/`addTurn`/`sessionsPayload`/`readTurns`/`trimTitle` — reuse directly. panel.ts:103/110/116/141/155/93/89.

### New endpoints to ADD

**Live stream**
- `GET /stream` — **SSE**. Set `content-type: text/event-stream`, `cache-control: no-store`, `connection: keep-alive`; push each hub event as `event: <topic>\ndata: <json>\n\n`; on first connect replay current `agent_identity`, the active session id, roster, and `agent_commands`; heartbeat comment every 15s; on `req.close` remove from `sseClients`. **(new — taps the existing `bus.event` emit sites)**
  - Wiring: add `const sseClients = new Set<http.ServerResponse>()` near the events array (panel.ts:57) and a helper `emitLive(topic, data)`; call `emitLive(...)` immediately after each existing `bus.event(...)` for the topics the browser needs: `assistant_message` (panel.ts:1540, 1471, 1926, 1962), `agent_status` (1527), `agent_commands` (1531), `agents_roster`/`announceRoster` (1186/1497/1567), `sessions`/`emitSessions` (1575), `history`/`emitHistory` (1574), `agent_identity` (1493/1560/1583). Reuses: the emit points already exist; we only fan a copy to SSE.

**Non-blocking send**
- `POST /ask-async` — body `{text, files?}`; `addTurn("user", text, parts?)` (panel.ts:141), `agentSock.send({t:"user", text, files?})` (same frame as 1907/1646), return `{ok:true}` immediately; 503 if no `agentSock`. Reply surfaces via `/stream` `assistant_message`. **(new — non-blocking sibling of `/say` at panel.ts:1896; reuses `addTurn` + `agentSock`)**

**Sessions CRUD + history** (all reuse the store at panel.ts:103–157; each also `emitLive("sessions", sessionsPayload())` / `emitLive("history", …)` so other open tabs and the phone stay in sync)
- `GET /sessions` — list newest-first → `sessionsPayload()` (panel.ts:155). **(new | reuses sessionsPayload)**
- `POST /sessions/new` — `newSession()` then return `sessionsPayload()`; emit sessions+history. **(new | reuses newSession panel.ts:103)**
- `POST /sessions/:id/select` — `selectSession(id)`; emit history+sessions; 404 if unknown. **(new | reuses selectSession panel.ts:110)**
- `DELETE /sessions/:id` — `deleteSession(id)`; emit sessions(+history if active changed). **(new | reuses deleteSession panel.ts:116)**
- `POST /sessions/:id/rename` — body `{title}`; set `sessions.find(...).title = trimTitle(title)` + `persistSessionsIndex()` (panel.ts:97/89); emit sessions. **(new — rename has NO implementation anywhere yet; add a tiny `renameSession(id,title)` next to deleteSession)**
- `GET /sessions/:id/history` — return that session's turns via `readTurns(sessionFilePath(id))` (panel.ts:93/87) as `{messages:[{role,text,ts,parts?}]}` (same shape as `histMsgs()` panel.ts:1573); used to hydrate the thread when switching sessions without disturbing the active one, and for export. **(new | reuses readTurns + sessionFilePath)**

**Files**
- `POST /upload` — accept raw bytes (header `x-file-name`, `content-type`) or multipart; `bus.putBlob(bytes, mime)` (peer.ts:190) → return `{blobId, name, mime, size}`. The browser then includes `parts:[{kind:"file"|"image", blobId, name, mime, size}]` (parts.ts:14–15) in the `/ask-async` body. **(new | reuses bus.putBlob — same call `/demo-file` makes at panel.ts:1959)**
- `GET /blob/:id` — **fix** the hardcoded `image/jpeg` (panel.ts:1872): read mime from `?mime=` query (or a small in-memory blob-mime map populated on `/upload`/`putBlob`) and set `content-disposition: attachment; filename=` for file (non-image) downloads. **(modify existing panel.ts:1870–1874)**

**Slash catalog exposure**
- `GET /commands` — return `{commands: agentCommands}` (the in-memory catalog the agent published, panel.ts:1530). The browser also receives live updates via `/stream` `agent_commands`; this endpoint is the initial fetch on load. **(new | reuses the `agentCommands` array)**

**Static assets**
- `GET /public/*` — stream `path.join(backboneDir, "public", safeRelPath)` (backboneDir = panel.ts:1296). Whitelist extensions (`.js`,`.css`,`.map`), guard against `..` traversal, set correct `content-type` + long `cache-control` (immutable; libs are versioned). **(new — first static-file route; `backbone/public/` already contains the vendored bundles)**

> Routing note: pattern-match `:id` paths with `url.pathname.startsWith("/sessions/")` + split, like the existing `/blob/` prefix match (panel.ts:1870).

---

## 4. Frontend

### Layout (responsive 3-region shell)
```
┌─────────────┬───────────────────────────────────────────┐
│  SIDEBAR    │  chathead: [agent ▾][Regular|Orchestrator] │  ← KEEP panel.ts:324-334
│  + New chat │           seat status ●                     │
│  🔍 search   ├───────────────────────────────────────────┤
│  ▸ Session A │  THREAD (.msgs)  — rich parts, autoscroll  │
│  ▸ Session B │     [thinking…] / [streaming] / [error⟳]   │
│  ▸ …         ├───────────────────────────────────────────┤
│             │  COMPOSER: [chips] textarea [Stop|Send]     │
└─────────────┴───────────────────────────────────────────┘
```
- **Desktop/tablet**: sidebar fixed-left, thread+composer fill. **Mobile (<720px)**: sidebar becomes an off-canvas drawer (hamburger in chathead); thread single-column. Reuse the dark token palette from `shellDoc` (panel.ts:280) — already WCAG-tuned.
- The chathead seat picker (`#agentsel`, `#modeseg`, `#seatstatus`) and its `ensureSeat()`/orchestrator logic move over **verbatim** from CHAT_BODY (panel.ts:324–414).

### Live-receive loop (which SSE topic drives what)
Open `const es = new EventSource('/stream')`. Handlers:
- `assistant_message` → if `data.askId` matches a pending regenerate, replace; else append an assistant bubble; render `data.text` + `data.parts` through the pipeline; clear the thinking row; `verifier`-style self-heal is server-side. (source: panel.ts:1540)
- `agent_status` → `{label, ready, command}`: show/replace the thinking indicator with `label` (e.g. "Thinking…", "Running tools…"); `ready===true` ends the turn (enable composer, hide Stop); if `command` present, surface the auth/affordance hint. (source: panel.ts:1527)
- `agent_commands` → refresh the slash catalog used by the `/` palette. (source: panel.ts:1531)
- `agents_roster` → re-fill `#agentsel` + seat status (replaces today's 4s `/status` poll; keep one poll as fallback). (source: panel.ts:1497/1567)
- `sessions` → re-render the sidebar list + active highlight. (source: panel.ts:1575)
- `history` → hydrate the thread when the active session changes from elsewhere (phone/other tab). (source: panel.ts:1574)
- `agent_identity` → update seat name. (source: panel.ts:1493)
- `es.onerror` → `EventSource` auto-reconnects; show a subtle "reconnecting…" chip; on reopen the server replays identity/session/roster/commands.

### Send path
Composer submit → `POST /ask-async {text, files?}` (returns instantly) → optimistic user bubble already appended → show thinking row → reply arrives via SSE. No blocking, no `pendingSay`.

### Slash-command menu
- Typing `/` at composer start (or `/` key when empty) opens a popover anchored above the composer, listing `agentCommands` (`{invoke, description, hint?, kind, group}`) grouped by `group`, fuzzy-filtered by prefix.
- Keyboard: ↑/↓ move, Enter/Tab accept (inserts `/<invoke> `), Esc closes. Mouse: click to accept.
- Special built-ins `/clear|/reset|/new` are recognized by the agent-runner already (regex, agent-runner.ts) — the menu just sends them as text; `/new` may also be wired to `POST /sessions/new` client-side for instant sidebar feedback.

### File UX (drag/drop/paste → chip → send → download)
- **Acquire**: drop on thread/composer, paste image from clipboard, or picker button. On acquire → `POST /upload` (streams bytes) → get `{blobId, name, mime, size}` → render a **chip** (icon by mime, name, size, remove ✕) above the textarea; show a progress bar while uploading.
- **Send**: chips become `parts:[{kind: mime.startsWith('image/')?'image':'file', blobId, name, mime, size}]` (parts.ts:14–15) attached to `/ask-async`; user bubble shows the chips inline.
- **Receive/Download**: assistant `parts` with `kind:image` → `<img src="/blob/:id?mime=...">` (lightbox on click, download button); `kind:file` → chip with download link to `/blob/:id?mime=...` (content-disposition set server-side). Mirrors phone `AgentImage`/`FilePart` (MainActivity.kt:1354/1121).

### Rendering pipeline (which vendored lib renders which type)
A `renderTurn(turn)` that builds DOM per `MsgPart` (and treats a bare `text` as one markdown part):
- **markdown / text** → `marked.parse(text)` → **`DOMPurify.sanitize(html)`** → innerHTML. (marked.min.js + purify.min.js)
- **fenced code** (inside markdown) → post-process `<pre><code class="language-x">` with **`hljs.highlightElement`** (highlight.js + github-dark.min.css), add a **language label + copy button** overlay.
- **table** part `{columns, rows}` → build a sanitized `<table>` with zebra striping + sticky header. (no lib)
- **mermaid** fenced blocks (```mermaid) → **`mermaid.render`** into an SVG. (mermaid.min.js)
- **image** part → `<img>` from `/blob`. **file** part → download chip.
- **JSON/XML** code blocks → highlight.js language modes (auto via class).
- Links rendered by marked get `target=_blank rel=noopener`; everything passes through DOMPurify (XSS gate — required since agent output is untrusted).

### States
- **Thinking**: animated row bound to `agent_status.label`; replaces the static `…` (panel.ts:401).
- **Streaming**: if the agent emits piecemeal `assistant_message` with the same `askId` (token-batching, optional), concatenate by `askId`; otherwise whole-message render. Show a caret/cursor while a turn is open.
- **Stop**: a **Stop** button replaces **Send** during an open turn → sends a control message (`/ask-async` with `{stop:true}` forwarding `{t:"user", text:"/stop"}` or an interrupt frame) and immediately re-enables the composer; the runaway reply, if any, is ignored by `askId`.
- **Regenerate**: per last-assistant action re-sends the prior user turn with a fresh `askId`, replacing the bubble on reply.
- **Error + Retry**: a `/ask-async` failure or SSE-timeout shows an error bubble (reuse `.msg.err`, panel.ts:317) with a **Retry** button that re-POSTs.
- **Empty**: reuse today's empty-state copy logic (panel.ts:368–372).
- **Autoscroll**: track `pinnedToBottom` (within 40px of bottom). New content scrolls only if pinned; otherwise show a floating **"↓ Jump to latest"** button.

### Keyboard map
| Key | Action |
|---|---|
| Enter | Send (composer) |
| Shift+Enter | Newline |
| `/` (empty composer) | Open slash menu |
| ↑ / ↓ (menu open) | Navigate commands |
| Enter / Tab (menu open) | Accept command |
| Esc | Close menu/modal/lightbox; cancel edit |
| ⌘/Ctrl+K | Focus session search |
| ⌘/Ctrl+⌫ | Stop generation |
| ↑ (empty composer) | Edit last user message |

---

## 5. Vendored libraries (already in `backbone/public/`, served via `GET /public/*`)

All are **UMD/IIFE single-file bundles** that attach a global on `<script src>` load — zero build, zero import resolution, offline-safe on the tailnet.

| File (present) | Global | Purpose | Why no-build |
|---|---|---|---|
| `marked.min.js` (35 KB) | `window.marked` | Markdown → HTML (headings, lists, emphasis, links, tables, fenced code). | UMD bundle; `marked.parse(str)` directly. |
| `highlight.min.js` (125 KB) + `github-dark.min.css` | `window.hljs` | Syntax highlighting, 190+ languages, code-block copy. | Self-contained IIFE + plain CSS. |
| `purify.min.js` (21 KB) | `window.DOMPurify` | Sanitize all rendered HTML (XSS gate for untrusted agent output). | UMD; `DOMPurify.sanitize(html)`. |
| `mermaid.min.js` (2.5 MB) | `window.mermaid` | Diagrams (flowchart/sequence/state/ERD/timeline) from ```mermaid blocks. | UMD; `mermaid.render(id, src)`. Lazy-load (large) only when a mermaid block appears. |

**To add later (same pattern, drop file into `public/`):** `katana`/KaTeX for math, Chart.js for charts, day.js for relative timestamps. No code change beyond a `<script src="/public/...">` and a renderer branch.

---

## 6. Build phases (each independently shippable + verifiable, ordered to de-risk)

**P1 — Static route + render pipeline (no live data yet).** Add `GET /public/*` (traversal-guarded). Add `renderTurn()` using marked+DOMPurify+highlight.js+tables+mermaid. Wire it into the *existing* `/say` flow so the current page immediately renders rich replies. Ship: `/chat` renders markdown/code/tables/mermaid from real agent output. De-risks the riskiest unknown (vendored UMD libs load + sanitize correctly) first, with zero backend protocol change.

**P2 — Live SSE receive + thinking.** Add `GET /stream`, `sseClients`, and `emitLive()` at the existing `bus.event` sites. Add `POST /ask-async`. Switch the composer from blocking `/say` to `/ask-async` + SSE. Render `agent_status` thinking indicator. Ship: messages stream in live, thinking state visible, no 60s block, multi-tab safe.

**P3 — Sessions sidebar.** Add `GET /sessions`, `POST /sessions/new`, `POST /sessions/:id/select`, `DELETE /sessions/:id`, `POST /sessions/:id/rename`, `GET /sessions/:id/history` (+ `renameSession`). Build sidebar (list, new, select, delete, rename, search) hydrating from these + live `sessions`/`history` SSE. Ship: full multi-session UX, shared with phone, survives refresh.

**P4 — Slash-command menu.** Add `GET /commands`; build the `/`-triggered fuzzy palette with keyboard nav, fed by `/commands` + live `agent_commands`. Ship: discoverable slash commands matching the phone.

**P5 — Files.** Add `POST /upload`, fix `GET /blob/:id` content-type + disposition. Build drag/drop/paste/picker → chip → send-as-parts → inline render + download. Ship: full file round-trip.

**P6 — Polish: stop + regenerate + states + a11y.** Stop button + interrupt; regenerate-last; error+retry bubble; autoscroll jump-button; per-message copy/edit/timestamp; ARIA/focus/contrast pass; responsive drawer; mobile layout. Ship: mature-bar complete.

---

## 7. STOP CRITERIA (DONE = every box checked)

### Per-feature parity (LIVE browser-verified via headless Chrome/CDP against a running hub at `/chat`)
- [ ] Markdown renders (headings/lists/links/blockquotes/tables) — verify DOM has `<h*>/<ul>/<a target=_blank>/<table>`.
- [ ] Code block shows language label + highlight.js classes + working copy button — verify `code.hljs` exists and clipboard receives source.
- [ ] Mermaid block renders an `<svg>` — verify SVG node present.
- [ ] Image part renders `<img src="/blob/...">` and downloads; file part chip downloads via `/blob/:id` with attachment disposition.
- [ ] Live `assistant_message` arrives over `/stream` (no `/say` block) — verify network shows `EventSource /stream` open and a bubble appears without a blocking XHR.
- [ ] Thinking indicator shows `agent_status.label` and clears on `ready` — verify the `.think` row mounts then unmounts.
- [ ] Sidebar: new/select/delete/rename/search work and reflect on the phone store — verify `GET /sessions` changes and history hydrates on select.
- [ ] Refresh restores the active session (no lost context).
- [ ] Slash menu opens on `/`, filters, keyboard-navigates, inserts `/<invoke> ` — verify popover DOM + selection.
- [ ] File: drag/drop + paste + picker each produce a chip, `POST /upload` returns a blobId, send attaches `parts`, recipient renders inline.
- [ ] Stop button halts an open turn and re-enables composer; Regenerate replaces the last assistant bubble.
- [ ] Error bubble + Retry on a forced failure (e.g. no agent → 503).
- [ ] Empty state shows on a fresh session; autoscroll "jump to latest" appears when scrolled up.
- [ ] Agent dropdown + Regular|Orchestrator mode still function (seat binds, orchestrator spawns) — unchanged behavior preserved.

### Mature-polish
- [ ] Keyboard map fully wired (Enter/Shift+Enter/`/`/Esc/⌘K/⌘⌫/↑-edit).
- [ ] Responsive: sidebar drawer on mobile, sidebar+thread on desktop (verify at 380px and 1280px viewports).
- [ ] Accessibility: ARIA roles/labels on thread/composer/menu, visible focus ring, focus trap in modals, no WCAG-AA contrast failures.
- [ ] Per-message copy + timestamp; user-message edit→resend.
- [ ] All rendered HTML passes through DOMPurify (XSS gate) — verify a `<script>` in agent output does not execute.

### Global gates
- [ ] `pnpm typecheck` (tsc --noEmit) → **0 errors**.
- [ ] `pnpm test` (tsx --test test/*.test.ts) → **all green**, including new tests for `/ask-async`, `/sessions/*`, `/upload`, `/stream` framing, `renameSession`.
- [ ] Hub boots clean (`pnpm hub`) with no new console errors.
- [ ] `GET /chat` → **200** and serves the new shell.
- [ ] `GET /public/marked.min.js` → **200** with `content-type: application/javascript`; `..` traversal → **403/404**.
- [ ] `GET /stream` → **200** `text/event-stream`, delivers a replayed `agent_identity`/`sessions` frame on connect.
- [ ] A single headless-Chrome E2E script drives one full conversation (send → thinking → rich reply → file → new session → slash command → stop) and asserts each above with **zero console errors**.

---

## Appendix — key file:line anchors
- Chat page (replace): `CHAT_CSS`/`CHAT_BODY` panel.ts:299–417; served at 1689 via `shellDoc` (276).
- Live emit points to tap for SSE: `bus.event` at 1527 (agent_status), 1531 (agent_commands), 1540 (assistant_message), 1574 (history), 1575 (sessions), 1493/1560 (agent_identity), `announceRoster` 1186/1497/1567.
- Blocking send to replace: `/say` 1896–1913; `pendingSay` 1175/1544/1906.
- Session store to reuse: 80–157 (newSession 103, selectSession 110, deleteSession 116, addTurn 141, sessionsPayload 155, readTurns 93, trimTitle 89, persistSessionsIndex 97, sessionFilePath 87).
- Phone session/relay flow to mirror: bus.onEvent 1576; new/select/delete 1609–1623; histMsgs/emitHistory/emitSessions 1573–1575.
- Agent transport (untouched): agent WS 1477; event handler 1522–1546; user frame 1907/1646.
- Files: `/blob` 1870 (fix content-type 1872); `bus.putBlob` peer.ts:190 (used at 1959); `MsgPart` parts.ts:11–16.
- Static base: `backboneDir` panel.ts:1296 → `backbone/public/` (vendored libs present).
- Route insertion point: before 404 tail panel.ts:2015; `json()` helper 1681.