/* Web chat client — a live peer of the phone app. Served statically (GET /public/chat.js).
 * Receives over SSE (GET /stream), sends non-blocking (POST /ask-async), renders rich parts
 * (markdown/code/tables/mermaid/images/files), drives the shared session store, and keeps the
 * agent dropdown + Regular|Orchestrator seat picker. No build step — vanilla ES, vendored UMD libs. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var msgs = $("msgs"), inp = $("inp"), composer = $("composer"), sendBtn = $("send"), stopBtn = $("stop"),
      sel = $("agentsel"), seg = $("modeseg"), seatEl = $("seatstatus"),
      sxlist = $("sxlist"), newchat = $("newchat"), sxsearch = $("sxsearch"),
      drawer = $("drawer"), sx = $("sx"), scrim = $("scrim"), jump = $("jump"),
      chipsEl = $("chips"), attachBtn = $("attach"), filein = $("filein"), slashEl = $("slash"),
      shell = document.querySelector(".chatshell");

  var roster = [], active = null, agentReady = null, mode = "regular", spawnedOrch = {};
  var sessions = [], activeSession = "";
  var attachments = [];        // {blobId,name,mime,size}
  var commands = [];           // slash catalog from the agent
  var busy = false, pinned = true, lastUserText = null;
  var mermaidLoaded = false, mermaidN = 0;

  // Material icons (mirror of panel.ts ICON_PATHS) for the elements built at runtime.
  var ICON_PATHS = {
    copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
    regen: "M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z",
    edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
    delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
    file: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
    close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    warning: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  };
  function ic(name, size) { return '<svg class="ic" viewBox="0 0 24 24" width="' + (size || 14) + '" height="' + (size || 14) + '" fill="currentColor" aria-hidden="true"><path d="' + (ICON_PATHS[name] || "") + '"/></svg>'; }

  if (window.marked && marked.setOptions) marked.setOptions({ gfm: true, breaks: true });

  // ---------- rich rendering ----------
  function sanitize(html) { return window.DOMPurify ? DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] }) : html; }
  function renderMarkdownInto(el, text) {
    el.innerHTML = sanitize(window.marked ? marked.parse(text || "") : (text || ""));
    enhance(el);
  }
  function enhance(el) {
    el.querySelectorAll("pre > code").forEach(function (code) {
      if (/language-mermaid/.test(code.className)) { renderMermaid(code); return; }
      try { if (window.hljs) hljs.highlightElement(code); } catch (e) {}
      addCodeChrome(code);
    });
    el.querySelectorAll("a").forEach(function (a) { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  }
  function addCodeChrome(code) {
    var pre = code.parentElement;
    if (!pre || (pre.parentElement && pre.parentElement.classList.contains("codewrap"))) return;
    var lang = (code.className.match(/language-([\w-]+)/) || [])[1] || "code";
    var wrap = document.createElement("div"); wrap.className = "codewrap";
    var head = document.createElement("div"); head.className = "codehead";
    var tag = document.createElement("span"); tag.textContent = lang; head.appendChild(tag);
    var cp = document.createElement("button"); cp.className = "copy"; cp.innerHTML = ic("copy", 12) + '<span class="lbl">Copy</span>';
    cp.onclick = function () { navigator.clipboard.writeText(code.textContent || ""); var l = cp.querySelector(".lbl"); l.textContent = "Copied"; setTimeout(function () { l.textContent = "Copy"; }, 1200); };
    head.appendChild(cp);
    pre.parentElement.insertBefore(wrap, pre); wrap.appendChild(head); wrap.appendChild(pre);
  }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  function ensureMermaid() {
    if (mermaidLoaded) return Promise.resolve();
    return loadScript("/public/vendor/mermaid.min.js").then(function () {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base",
        themeVariables: { background: "#14161e", primaryColor: "#21242f", primaryTextColor: "#eceef4", primaryBorderColor: "#6366f1",
          lineColor: "#9b9eab", secondaryColor: "#1a1d27", tertiaryColor: "#1a1d27", fontSize: "14px", textColor: "#eceef4" } });
      mermaidLoaded = true;
    });
  }
  function renderMermaid(code) {
    var src = code.textContent || "", pre = code.closest("pre");
    ensureMermaid().then(function () {
      return mermaid.render("mmd" + (++mermaidN), src);
    }).then(function (out) {
      var div = document.createElement("div"); div.className = "mermaid";
      // Trust mermaid's own sanitizer (securityLevel:'strict' runs DOMPurify on its output, designed for
      // untrusted input). Re-running our HTML/SVG-profile DOMPurify here strips the <foreignObject> HTML
      // labels and leaves empty boxes — so inject mermaid's already-sanitized SVG directly.
      div.innerHTML = out.svg;
      if (pre) pre.replaceWith(div);
    }).catch(function () { try { if (window.hljs) hljs.highlightElement(code); } catch (e) {} addCodeChrome(code); });
  }
  function fmtSize(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

  // ---------- bubbles + parts ----------
  function bubble(cls) { var d = document.createElement("div"); d.className = "msg " + cls; msgs.appendChild(d); autoscroll(); return d; }
  function renderTurn(role, text, parts) {
    clearEmpty();
    var b = bubble(role === "user" ? "user" : "bot");
    if (parts && parts.length) {
      // parts are the rich representation; `text` is the fallback. Don't lose accompanying prose when
      // parts carry only media (image/file/table) and no text/markdown part of their own.
      var hasText = parts.some(function (p) { return p.kind === "text" || p.kind === "markdown"; });
      if (text && !hasText) { var lead = document.createElement("div"); lead.className = "md"; renderMarkdownInto(lead, text); b.appendChild(lead); }
      parts.forEach(function (p) { renderPart(b, p); });
    } else { var md = document.createElement("div"); md.className = "md"; renderMarkdownInto(md, text); b.appendChild(md); }
    addMsgActions(b, role, text);
    autoscroll();
    return b;
  }
  function renderPart(b, p) {
    if (p.kind === "text" || p.kind === "markdown") { var d = document.createElement("div"); d.className = "md"; renderMarkdownInto(d, p.text || ""); b.appendChild(d); }
    else if (p.kind === "image") { var img = document.createElement("img"); img.className = "partimg"; img.src = "/blob/" + p.blobId + "?mime=" + encodeURIComponent(p.mime || "image/jpeg"); img.alt = p.alt || "image"; img.onclick = function () { window.open(img.src, "_blank"); }; b.appendChild(img); }
    else if (p.kind === "file") { b.appendChild(fileChip(p)); }
    else if (p.kind === "table") { b.appendChild(tableEl(p.columns || [], p.rows || [])); }
  }
  function fileChip(p) {
    var a = document.createElement("a"); a.className = "filechip";
    a.href = "/blob/" + p.blobId + "?download=1&mime=" + encodeURIComponent(p.mime || "application/octet-stream") + "&name=" + encodeURIComponent(p.name || "file");
    a.setAttribute("download", p.name || "file");
    var fi = document.createElement("span"); fi.className = "fi"; fi.innerHTML = ic("file", 16); a.appendChild(fi);
    var fn = document.createElement("span"); fn.className = "fn"; fn.textContent = p.name || "file"; a.appendChild(fn);
    if (p.size) { var fs = document.createElement("span"); fs.className = "fs"; fs.textContent = fmtSize(p.size); a.appendChild(fs); }
    return a;
  }
  function tableEl(cols, rows) {
    var t = document.createElement("table"); var thead = document.createElement("thead"); var htr = document.createElement("tr");
    cols.forEach(function (c) { var th = document.createElement("th"); th.textContent = c; htr.appendChild(th); });
    thead.appendChild(htr); t.appendChild(thead);
    var tb = document.createElement("tbody");
    rows.forEach(function (r) { var tr = document.createElement("tr"); r.forEach(function (c) { var td = document.createElement("td"); td.textContent = c; tr.appendChild(td); }); tb.appendChild(tr); });
    t.appendChild(tb); var wrap = document.createElement("div"); wrap.className = "md"; wrap.appendChild(t); return wrap;
  }
  function addMsgActions(b, role, text) {
    var acts = document.createElement("div"); acts.className = "acts";
    var copy = document.createElement("button"); copy.title = "Copy"; copy.innerHTML = ic("copy", 14) + '<span class="lbl">Copy</span>';
    copy.onclick = function () { navigator.clipboard.writeText(text || b.textContent || ""); var l = copy.querySelector(".lbl"); l.textContent = "Copied"; setTimeout(function () { l.textContent = "Copy"; }, 1200); };
    acts.appendChild(copy);
    if (role === "assistant") { var rg = document.createElement("button"); rg.title = "Regenerate"; rg.innerHTML = ic("regen", 14) + "<span>Regenerate</span>"; rg.onclick = function () { if (lastUserText != null && !busy) send(lastUserText); }; acts.appendChild(rg); }
    if (role === "user") { var ed = document.createElement("button"); ed.title = "Edit"; ed.innerHTML = ic("edit", 14) + "<span>Edit</span>"; ed.onclick = function () { inp.value = text || ""; autosize(); inp.focus(); }; acts.appendChild(ed); }
    b.appendChild(acts);
  }

  // ---------- thinking / states ----------
  var thinkRow = null;
  function showThinking(label) {
    if (!thinkRow) { thinkRow = document.createElement("div"); thinkRow.className = "msg think"; msgs.appendChild(thinkRow); }
    thinkRow.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    var t = document.createElement("span"); t.textContent = label || "Thinking…"; thinkRow.appendChild(t);
    autoscroll();
  }
  function clearThinking() { if (thinkRow) { thinkRow.remove(); thinkRow = null; } }
  function setBusy(b) { busy = b; sendBtn.hidden = b; stopBtn.hidden = !b; sendBtn.disabled = b || !roster.length; }
  function errorBubble(msg, retry) {
    clearThinking();
    var b = bubble("err"); var ico = document.createElement("span"); ico.className = "ei"; ico.innerHTML = ic("warning", 15); b.appendChild(ico);
    b.appendChild(document.createTextNode(" " + msg + " "));
    var r = document.createElement("button"); r.className = "retry"; r.textContent = "Retry"; r.onclick = function () { b.remove(); retry(); }; b.appendChild(r);
  }
  function clearEmpty() { var e = msgs.querySelector(".empty"); if (e) e.remove(); }
  function maybeEmpty() { if (!msgs.querySelector(".msg") && !msgs.querySelector(".empty")) { var e = document.createElement("div"); e.className = "empty"; e.textContent = roster.length ? "Start the conversation — type a message below." : "No harness connected. Start one in Connections; it’ll appear here."; msgs.appendChild(e); } }

  // ---------- autoscroll ----------
  function autoscroll() { if (pinned) msgs.scrollTop = msgs.scrollHeight; }
  msgs.addEventListener("scroll", function () { pinned = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60; jump.hidden = pinned; });
  jump.onclick = function () { pinned = true; autoscroll(); jump.hidden = true; };

  // ---------- live receive (SSE) ----------
  function connectStream() {
    var es = new EventSource("/stream");
    es.addEventListener("assistant_message", function (e) { var d = JSON.parse(e.data); clearThinking(); setBusy(false); renderTurn("assistant", d.text || "", d.parts); });
    es.addEventListener("agent_status", function (e) {
      var d = JSON.parse(e.data);
      if (d.ready === true) { clearThinking(); setBusy(false); agentReady = true; }
      else if (d.ready === false) { agentReady = false; if (d.label) showThinking(d.label); }
      else if (d.label) { if (busy) showThinking(d.label); }
      renderSeat();
    });
    es.addEventListener("agent_commands", function (e) { commands = JSON.parse(e.data).commands || []; });
    // agents_roster carries rosterList() — every entry is already a connected agent (no `connected` field).
    es.addEventListener("agents_roster", function (e) { roster = JSON.parse(e.data).agents || []; active = roster.filter(function (a) { return a.active; })[0] || null; fillAgents(); renderSeat(); maybeEmpty(); });
    es.addEventListener("agent_identity", function (e) { renderSeat(); });
    es.addEventListener("sessions", function (e) { var d = JSON.parse(e.data); sessions = d.sessions || []; if (d.activeId) activeSession = d.activeId; renderSessions(); });
    es.addEventListener("history", function (e) { hydrate((JSON.parse(e.data).messages) || []); });
    es.addEventListener("orch", function (e) { onOrch(JSON.parse(e.data)); });
    es.addEventListener("orch_clear", function () { orch.clear(); orchSeen.clear(); orchCollapsed.clear(); renderOrch(); updateOlive(); });
    es.onopen = function () { var rc = document.querySelector(".reconnect"); if (rc) rc.remove(); };
    es.onerror = function () { if (!document.querySelector(".reconnect")) { var rc = document.createElement("div"); rc.className = "reconnect"; rc.textContent = "reconnecting…"; document.querySelector(".cmain").appendChild(rc); } };
  }
  function hydrate(messages) {
    msgs.innerHTML = ""; thinkRow = null;
    messages.forEach(function (m) { renderTurn(m.role, m.text || "", m.parts); });
    maybeEmpty(); pinned = true; autoscroll();
  }

  // ---------- send ----------
  function send(text) {
    if (busy) return;
    var parts = attachments.map(function (a) { return { kind: (a.mime && a.mime.indexOf("image/") === 0) ? "image" : "file", blobId: a.blobId, name: a.name, mime: a.mime, size: a.size }; });
    renderTurn("user", text, parts.length ? parts : undefined);
    lastUserText = text; clearAttachments();
    setBusy(true); showThinking("Thinking…");
    ensureSeat().then(function () {
      return post("/ask-async", { text: text, parts: parts.length ? parts : undefined });
    }).then(function (r) {
      // {ok:true} = accepted; the reply arrives later over SSE, so stay "thinking". Only clear on failure.
      if (r && r.ok === false) { setBusy(false); errorBubble(r.error || "send failed", function () { send(text); }); }
    }).catch(function (e) { setBusy(false); errorBubble(String((e && e.message) || e), function () { send(text); }); });
  }
  stopBtn.onclick = function () { clearThinking(); setBusy(false); post("/agent/interrupt").catch(function () {}); };

  // ---------- seat picker (agent dropdown + Regular|Orchestrator) ----------
  function selectedAgent() { return roster.filter(function (a) { return a.id === sel.value; })[0] || null; }
  function orchAllowed(a) { if (!a) return false; if (a.orchestrator) return true; return a.kind !== "external"; }
  function syncModeButtons() { [].forEach.call(seg.querySelectorAll("button"), function (b) { b.classList.toggle("on", b.getAttribute("data-m") === mode); }); }
  function renderSeat() {
    var a = selectedAgent(), oBtn = seg.querySelector('[data-m="orchestrator"]'), allowed = orchAllowed(a);
    oBtn.disabled = !allowed;
    if (!allowed && mode === "orchestrator") { mode = "regular"; syncModeButtons(); }
    oBtn.title = allowed ? "Orchestrator: this harness takes the hub driver seat and can delegate to your other (regular) harnesses." : "Remote harness — start it with AGENT_HUBS on its own host to use it as an orchestrator.";
    seatEl.innerHTML = "";
    var dot = document.createElement("span"); dot.className = "dot" + (active && agentReady ? " ok" : ""); seatEl.appendChild(dot);
    var t = document.createElement("span"); t.textContent = active ? ("Driver seat: " + active.name + (agentReady === false ? " (not ready)" : "")) : "No harness in the driver seat"; seatEl.appendChild(t);
  }
  function fillAgents() {
    var keep = sel.value;
    sel.innerHTML = "";
    if (!roster.length) { var o = document.createElement("option"); o.value = ""; o.textContent = "— no agents —"; sel.appendChild(o); sel.disabled = true; setBusy(busy); return; }
    sel.disabled = false;
    roster.forEach(function (a) { var o = document.createElement("option"); o.value = a.id; o.textContent = a.name + (a.orchestrator ? " ⚡" : "") + (a.external ? " ☁" : ""); sel.appendChild(o); });
    var def = keep && roster.some(function (a) { return a.id === keep; }) ? keep : (active && roster.some(function (a) { return a.id === active.id; }) ? active.id : roster[0].id);
    sel.value = def;
    sendBtn.disabled = busy || !roster.length;
  }
  function waitConnected(id, timeout) {
    var start = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        fetch("/status").then(function (r) { return r.json(); }).then(function (s) {
          if ((s.agents || []).some(function (a) { return a.id === id && a.connected; })) return resolve(id);
          if (Date.now() - start > timeout) return reject(new Error("orchestrator did not connect in time"));
          setTimeout(poll, 500);
        }).catch(function () { setTimeout(poll, 500); });
      })();
    });
  }
  function ensureSeat() {
    var a = selectedAgent();
    if (!a) return Promise.reject(new Error("no agent connected"));
    if (mode === "regular" || a.orchestrator) {
      if (active && active.id === a.id) return Promise.resolve();
      return post("/agent/select", { id: a.id });
    }
    var kind = a.kind || "claude", existing = spawnedOrch[kind];
    if (existing && roster.some(function (x) { return x.id === existing; })) return post("/agent/select", { id: existing });
    return post("/agent/start", { type: kind, orchestrator: true, name: a.name + " ⚡" }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || "could not start an orchestrator");
      spawnedOrch[kind] = r.id; return waitConnected(r.id, 20000);
    }).then(function (id) { return post("/agent/select", { id: id }); });
  }
  sel.addEventListener("change", renderSeat);
  seg.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b || b.disabled) return; mode = b.getAttribute("data-m"); syncModeButtons(); renderSeat(); });

  // ---------- sessions sidebar ----------
  function renderSessions() {
    var q = (sxsearch.value || "").toLowerCase();
    sxlist.innerHTML = "";
    var list = sessions.filter(function (s) { return !q || (s.title || "").toLowerCase().indexOf(q) >= 0; });
    if (!list.length) { var e = document.createElement("div"); e.className = "sxempty"; e.textContent = q ? "No matches" : "No chats yet"; sxlist.appendChild(e); return; }
    list.forEach(function (s) {
      var it = document.createElement("div"); it.className = "sxitem" + (s.id === activeSession ? " on" : "");
      var t = document.createElement("div"); t.className = "t"; t.textContent = s.title || "New chat"; it.appendChild(t);
      it.onclick = function () { selectSession(s.id); };
      var act = document.createElement("div"); act.className = "act";
      var rn = document.createElement("button"); rn.innerHTML = ic("edit", 14); rn.title = "Rename"; rn.onclick = function (ev) { ev.stopPropagation(); startRename(it, t, s); };
      var dl = document.createElement("button"); dl.className = "del"; dl.innerHTML = ic("delete", 14); dl.title = "Delete"; dl.onclick = function (ev) { ev.stopPropagation(); if (confirm("Delete this chat?")) post("/session/delete", { id: s.id }); };
      act.appendChild(rn); act.appendChild(dl); it.appendChild(act);
      sxlist.appendChild(it);
    });
  }
  function startRename(it, t, s) {
    var box = document.createElement("input"); box.value = s.title || ""; t.innerHTML = ""; t.appendChild(box); box.focus(); box.select();
    function commit() { var v = box.value.trim(); if (v && v !== s.title) post("/session/rename", { id: s.id, title: v }); else renderSessions(); }
    box.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") renderSessions(); };
    box.onblur = commit; box.onclick = function (e) { e.stopPropagation(); };
  }
  function selectSession(id) { activeSession = id; renderSessions(); post("/session/select", { id: id }); closeDrawer(); }
  newchat.onclick = function () { post("/session/new", {}); closeDrawer(); };
  sxsearch.oninput = renderSessions;

  // ---------- drawer (mobile) ----------
  function openDrawer() { shell.classList.add("drawer-open"); scrim.hidden = false; }
  function closeDrawer() { shell.classList.remove("drawer-open"); scrim.hidden = true; }
  drawer.onclick = function () { shell.classList.contains("drawer-open") ? closeDrawer() : openDrawer(); };
  scrim.onclick = closeDrawer;

  // ---------- files ----------
  attachBtn.onclick = function () { filein.click(); };
  filein.onchange = function (e) { uploadFiles(e.target.files); filein.value = ""; };
  function uploadFiles(fileList) {
    [].forEach.call(fileList, function (file) {
      var entry = { blobId: null, name: file.name, mime: file.type || "application/octet-stream", size: file.size, uploading: true };
      attachments.push(entry); renderChips();
      fetch("/upload?name=" + encodeURIComponent(file.name) + "&mime=" + encodeURIComponent(entry.mime), { method: "POST", body: file })
        .then(function (r) { return r.json(); })
        .then(function (r) { if (r && r.ok) { entry.blobId = r.blobId; entry.uploading = false; } else { remove(entry); } renderChips(); })
        .catch(function () { remove(entry); renderChips(); });
    });
  }
  function remove(entry) { attachments = attachments.filter(function (a) { return a !== entry; }); }
  function clearAttachments() { attachments = []; renderChips(); }
  function renderChips() {
    chipsEl.innerHTML = "";
    attachments.forEach(function (a) {
      var c = document.createElement("div"); c.className = "chip" + (a.uploading ? " uploading" : "");
      var n = document.createElement("span"); n.textContent = a.name + (a.size ? " · " + fmtSize(a.size) : ""); c.appendChild(n);
      var x = document.createElement("button"); x.className = "x"; x.innerHTML = ic("close", 14); x.onclick = function () { remove(a); renderChips(); }; c.appendChild(x);
      chipsEl.appendChild(c);
    });
  }
  var cmain = document.querySelector(".cmain");
  cmain.addEventListener("dragover", function (e) { e.preventDefault(); cmain.classList.add("dragover"); });
  cmain.addEventListener("dragleave", function (e) { if (e.target === cmain) cmain.classList.remove("dragover"); });
  cmain.addEventListener("drop", function (e) { e.preventDefault(); cmain.classList.remove("dragover"); if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });
  inp.addEventListener("paste", function (e) { var files = []; [].forEach.call(e.clipboardData.items || [], function (it) { if (it.kind === "file") { var f = it.getAsFile(); if (f) files.push(f); } }); if (files.length) { e.preventDefault(); uploadFiles(files); } });

  // ---------- slash menu ----------
  var slashOpen = false, slashItems = [], slashIdx = 0;
  function builtins() { return [{ invoke: "new", description: "Start a new chat (session)", group: "Session" }, { invoke: "clear", description: "Clear the agent’s context", group: "Session" }]; }
  function openSlash() {
    var q = inp.value.replace(/^\//, "").toLowerCase();
    var all = builtins().concat((commands || []).map(function (c) { return { invoke: c.invoke || c.name || c.command || "", description: c.description || c.summary || c.hint || "", group: c.group || "Commands" }; }));
    slashItems = all.filter(function (c) { return c.invoke && c.invoke.toLowerCase().indexOf(q) === 0; });
    if (!slashItems.length) { closeSlash(); return; }
    slashIdx = Math.min(slashIdx, slashItems.length - 1);
    slashEl.innerHTML = ""; var lastGroup = null;
    slashItems.forEach(function (c, i) {
      if (c.group !== lastGroup) { lastGroup = c.group; var g = document.createElement("div"); g.className = "slashgroup"; g.textContent = c.group; slashEl.appendChild(g); }
      var it = document.createElement("div"); it.className = "slashitem" + (i === slashIdx ? " on" : ""); it.setAttribute("role", "option");
      var cmd = document.createElement("span"); cmd.className = "cmd"; cmd.textContent = "/" + c.invoke; it.appendChild(cmd);
      var d = document.createElement("span"); d.className = "desc"; d.textContent = c.description; it.appendChild(d);
      it.onmousedown = function (e) { e.preventDefault(); acceptSlash(i); };
      slashEl.appendChild(it);
    });
    slashEl.hidden = false; slashOpen = true;
  }
  function closeSlash() { slashEl.hidden = true; slashOpen = false; slashIdx = 0; }
  function acceptSlash(i) { var c = slashItems[i]; if (!c) return; inp.value = "/" + c.invoke + " "; closeSlash(); autosize(); inp.focus(); }

  // ---------- composer keys ----------
  function autosize() { inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 200) + "px"; }
  inp.addEventListener("input", function () { autosize(); if (inp.value[0] === "/" && inp.value.indexOf(" ") < 0) openSlash(); else closeSlash(); });
  inp.addEventListener("keydown", function (e) {
    if (slashOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); slashIdx = (slashIdx + 1) % slashItems.length; openSlash(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); slashIdx = (slashIdx - 1 + slashItems.length) % slashItems.length; openSlash(); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); acceptSlash(slashIdx); return; }
      if (e.key === "Escape") { e.preventDefault(); closeSlash(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); }
  });
  composer.addEventListener("submit", function (e) {
    e.preventDefault();
    var t = inp.value.trim();
    closeSlash();
    if (t === "/new") { inp.value = ""; autosize(); post("/session/new", {}); return; }
    if (!t && !attachments.length) return;
    if (busy) return;
    inp.value = ""; autosize(); send(t);
  });
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); sxsearch.focus(); }
    if ((e.metaKey || e.ctrlKey) && e.key === "Backspace" && busy) { e.preventDefault(); stopBtn.click(); }
  });

  // ---------- helpers ----------
  function post(url, body) { return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }); }); }

  // ---------- orchestration panel (live delegation + internal-subagent tree) ----------
  var orch = new Map(), orchOpen = false, orchAutoOpened = false, orchSeen = new Set(), orchRenderQ = null, orchCollapsed = new Set();
  var orchtip = $("orchtip");
  var orchpanel = $("orchpanel"), orchtree = $("orchtree"), orchtoggle = $("orchtoggle"), orchclose = $("orchclose"), orchclear = $("orchclear"), olive = $("olive");
  if (orchpanel) orchpanel.hidden = false; // visibility is driven by the .orch-open width, not [hidden]
  function openOrch() { shell.classList.add("orch-open"); orchOpen = true; if (orchtoggle) orchtoggle.classList.remove("live"); }
  function closeOrch() { shell.classList.remove("orch-open"); orchOpen = false; }
  if (orchtoggle) orchtoggle.onclick = function () { orchOpen ? closeOrch() : openOrch(); };
  if (orchclose) orchclose.onclick = closeOrch;
  if (orchclear) orchclear.onclick = function () { orch.clear(); orchSeen.clear(); orchCollapsed.clear(); renderOrch(); updateOlive(); post("/orch/clear"); };
  function onOrch(n) {
    var prev = orch.get(n.id);
    if (prev && prev.status === "running" && n.status !== "running") flyUp(n); // value bubbles up to its parent
    orch.set(n.id, n);
    var real = n.kind === "delegation" || n.kind === "subagent";
    if (real && !orchOpen && !orchAutoOpened) { orchAutoOpened = true; openOrch(); }      // surface it on first real fan-out
    else if (real && !orchOpen && orchtoggle) orchtoggle.classList.add("live");
    scheduleOrchRender(); updateOlive();
  }
  function updateOlive() { if (olive) olive.classList.toggle("on", [].some.call(orch.values ? [...orch.values()] : [], function (x) { return x.status === "running"; })); }
  function scheduleOrchRender() { if (orchRenderQ) return; orchRenderQ = requestAnimationFrame(function () { orchRenderQ = null; renderOrch(); }); }
  function odisplay(n) {
    if (n.kind === "turn") return { tag: "you", name: n.agentName, sub: n.label };
    if (n.kind === "delegation") return { tag: "delegate", name: n.agentName, sub: n.label };
    if (n.kind === "subagent") { var p = (n.label || "").split(": "); return { tag: "subagent", name: p[0] || "subagent", sub: p.slice(1).join(": ") }; }
    return { tag: "tool", name: n.label || "tool", sub: "" };
  }
  function ometa(n) { if (n.status === "running") return "…"; if (n.ms == null) return ""; return n.ms < 1000 ? n.ms + "ms" : (n.ms / 1000).toFixed(1) + "s"; }
  function oesc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // File-system tree: nested .onode boxes so CSS can draw the folder guides. A node's connector colours
  // in when it FINISHES (its result has returned up the chain); the reply rides as data-reply for the
  // hover tooltip, so the whole chain of results is readable from the tree alone.
  function renderOrch() {
    if (!orchtree) return;
    if (orchclear) orchclear.disabled = !orch.size;
    if (!orch.size) { orchtree.innerHTML = '<div class="oempty">No orchestration yet.<br>Open a session with a harness as <b>Orchestrator</b> and ask it to delegate — the live tree builds here.</div>'; return; }
    var all = [...orch.values()], childOf = {}, roots = [];
    all.forEach(function (n) { if (n.parentId && orch.has(n.parentId)) { (childOf[n.parentId] = childOf[n.parentId] || []).push(n); } else roots.push(n); });
    Object.keys(childOf).forEach(function (k) { childOf[k].sort(function (a, b) { return a.ts - b.ts; }); });
    roots.sort(function (a, b) { return a.ts - b.ts; });
    function nodeHtml(n) {
      var d = odisplay(n), isNew = !orchSeen.has(n.id); orchSeen.add(n.id);
      var settled = n.status !== "running", kids = childOf[n.id] || [], collapsed = orchCollapsed.has(n.id);
      var caret = kids.length
        ? '<span class="ocaret' + (collapsed ? " collapsed" : "") + '" data-tog="' + n.id + '">▾</span>'
        : '<span class="ocaret-none"></span>';
      var reply = (settled && n.reply) ? n.reply : "";
      var attrs = reply ? ' data-reply="' + oesc(reply) + '" data-rname="' + oesc(d.tag + " · " + d.name) + '"' : "";
      var row = '<div class="orow ' + n.status + (isNew ? " new" : "") + (settled ? " settled" : "") + '"' + attrs + ' id="orow_' + n.id + '">'
        + caret + '<div class="odot ' + n.status + '"></div><div class="obody"><div class="oline">'
        + '<span class="okind ' + n.kind + '">' + oesc(d.tag) + '</span><span class="oname">' + oesc(d.name) + '</span><span class="ometa">' + oesc(ometa(n)) + '</span></div>'
        + (d.sub ? '<div class="olabel">' + oesc(d.sub) + '</div>' : "") + '</div></div>';
      var kidsHtml = (kids.length && !collapsed) ? '<div class="okids">' + kids.map(nodeHtml).join("") + '</div>' : "";
      return '<div class="onode ' + n.status + '">' + row + kidsHtml + '</div>';
    }
    orchtree.innerHTML = roots.map(nodeHtml).join("");
  }
  function hideTip() { if (orchtip) orchtip.hidden = true; }
  function positionTip(e) {
    if (!orchtip || orchtip.hidden) return;
    var pad = 12, tw = orchtip.offsetWidth || 320, th = orchtip.offsetHeight || 80;
    var x = e.clientX - tw - 16; if (x < pad) x = e.clientX + 18;        // prefer left of cursor (the panel is on the right)
    var y = e.clientY + 14; if (y + th > window.innerHeight - pad) y = window.innerHeight - th - pad;
    orchtip.style.left = Math.max(pad, x) + "px"; orchtip.style.top = Math.max(pad, y) + "px";
  }
  if (orchtree) {
    orchtree.addEventListener("click", function (e) {                    // folder open/close
      var c = e.target.closest("[data-tog]"); if (!c) return;
      var id = c.getAttribute("data-tog"); if (orchCollapsed.has(id)) orchCollapsed.delete(id); else orchCollapsed.add(id);
      renderOrch();
    });
    orchtree.addEventListener("mouseover", function (e) {                // reply tooltip
      var r = e.target.closest(".orow[data-reply]"); if (!r || !orchtip) return;
      orchtip.innerHTML = '<span class="tname"></span><div class="treply"></div>';
      orchtip.querySelector(".tname").textContent = r.getAttribute("data-rname") || "";
      orchtip.querySelector(".treply").textContent = r.getAttribute("data-reply") || "";
      orchtip.hidden = false; positionTip(e);
    });
    orchtree.addEventListener("mousemove", positionTip);
    orchtree.addEventListener("mouseout", function (e) { if (e.target.closest(".orow[data-reply]")) hideTip(); });
  }

  // ---------- resizable side panels: drag the splitters; widths persist; chat keeps a min width ----------
  (function setupResizers() {
    var SX_MIN = 190, SX_MAX = 460, ORCH_MIN = 300, ORCH_MAX = 860, CHAT_MIN = 380;
    function px(name, dflt) { return parseInt(getComputedStyle(shell).getPropertyValue(name)) || dflt; }
    var curSx = function () { return px("--sx-w", 256); }, curOrch = function () { return px("--orch-w", 460); };
    function applySx(w) {
      var orchW = orchOpen ? curOrch() : 0;
      w = Math.max(SX_MIN, Math.min(w, SX_MAX, window.innerWidth - CHAT_MIN - orchW));
      shell.style.setProperty("--sx-w", w + "px");
      try { localStorage.setItem("sxWidth", w); } catch (e) {}
    }
    function applyOrch(w) {
      w = Math.max(ORCH_MIN, Math.min(w, ORCH_MAX, window.innerWidth - CHAT_MIN - curSx()));
      shell.style.setProperty("--orch-w", w + "px");
      try { localStorage.setItem("orchWidth", w); } catch (e) {}
    }
    var s = parseInt(localStorage.getItem("sxWidth")); if (s) applySx(s);
    var o = parseInt(localStorage.getItem("orchWidth")); if (o) applyOrch(o);
    function drag(handle, getStart, onMove, sign) {
      if (!handle) return;
      handle.addEventListener("pointerdown", function (e) {
        e.preventDefault(); handle.setPointerCapture(e.pointerId);
        var startX = e.clientX, startW = getStart();
        handle.classList.add("dragging"); shell.classList.add("resizing");
        function move(ev) { onMove(startW + sign * (ev.clientX - startX)); }
        function up() {
          handle.classList.remove("dragging"); shell.classList.remove("resizing");
          handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up);
        }
        handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up);
      });
    }
    drag($("sxrsz"), curSx, applySx, 1);        // drag right edge → list grows
    drag($("orchrsz"), curOrch, applyOrch, -1); // drag left edge → panel grows
    window.addEventListener("resize", function () { applySx(curSx()); applyOrch(curOrch()); });
  })();
  function flyUp(n) {
    if (!n.parentId || !n.reply) return;
    var childEl = document.getElementById("orow_" + n.id), parentEl = document.getElementById("orow_" + n.parentId);
    if (!childEl || !parentEl) return;
    var c = childEl.getBoundingClientRect(), p = parentEl.getBoundingClientRect();
    var chip = document.createElement("div"); chip.className = "ofly"; chip.textContent = n.reply.slice(0, 36);
    chip.style.left = (c.left + 14) + "px"; chip.style.top = c.top + "px";
    document.body.appendChild(chip);
    requestAnimationFrame(function () { chip.style.transform = "translate(" + (p.left - c.left) + "px," + (p.top - c.top) + "px)"; });
    setTimeout(function () { chip.style.opacity = "0"; }, 650);
    setTimeout(function () { chip.remove(); }, 1250);
  }

  // Test/automation hook: render a turn into the thread (used by the headless-Chrome E2E to exercise the
  // real render pipeline with content the built-in agents don't produce). Harmless — it only appends DOM.
  window.__chatRender = renderTurn;

  // ---------- init ----------
  fetch("/commands").then(function (r) { return r.json(); }).then(function (d) { commands = d.commands || []; }).catch(function () {});
  connectStream();
  maybeEmpty();
  inp.focus();
})();
