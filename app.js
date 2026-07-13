/* ============================================================
   SITE LOG — AI Field Records
   Self-contained PWA. No backend required except optional
   Google Apps Script sync endpoint (see apps-script.gs / README).
   ============================================================ */

const DEFAULT_STATIONS = [
  "Noida Sector 51","Noida Sector 50","Noida Sector 76","Noida Sector 101",
  "Noida Sector 81","NSEZ","Noida Sector 83","Noida Sector 137",
  "Noida Sector 142","Noida Sector 143","Noida Sector 144","Noida Sector 145",
  "Noida Sector 146","Noida Sector 147","Noida Sector 148",
  "Knowledge Park II","Pari Chowk","Alpha 1","Delta 1","GNIDA Office","Depot",
  "Other / Custom Site"
];

const CATEGORIES = ["Safety","Quality","Progress","Material","Issue","General"];

/* ---------------- IndexedDB ---------------- */
const DB_NAME = "sitelog_db";
const DB_VERSION = 1;
let db;

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if(!_db.objectStoreNames.contains("records")){
        const store = _db.createObjectStore("records", { keyPath: "id" });
        store.createIndex("timestamp", "timestamp");
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e);
  });
}

function dbGetAll(){
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readonly");
    const store = tx.objectStore("records");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.sort((a,b) => b.timestamp - a.timestamp));
    req.onerror = (e) => reject(e);
  });
}

function dbPut(record){
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = (e) => reject(e);
  });
}

function dbDelete(id){
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

/* ---------------- Settings (localStorage) ---------------- */
const MODELS_BY_PROVIDER = {
  anthropic: [
    { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 — fastest, cheapest" },
    { value: "claude-sonnet-5", label: "Sonnet 5 — more accurate" }
  ],
  deepseek: [
    { value: "deepseek-v4-flash", label: "V4 Flash — fastest, cheapest" },
    { value: "deepseek-v4-pro", label: "V4 Pro — more accurate" }
  ]
};

function getSettings(){
  return {
    provider: localStorage.getItem("sl_provider") || "anthropic",
    apiKey: localStorage.getItem("sl_apiKey") || "",
    model: localStorage.getItem("sl_model") || "claude-haiku-4-5-20251001",
    webhook: localStorage.getItem("sl_webhook") || "",
    stations: JSON.parse(localStorage.getItem("sl_stations") || "null") || DEFAULT_STATIONS
  };
}
function saveSettings(s){
  localStorage.setItem("sl_provider", s.provider || "anthropic");
  localStorage.setItem("sl_apiKey", s.apiKey || "");
  localStorage.setItem("sl_model", s.model || "claude-haiku-4-5-20251001");
  localStorage.setItem("sl_webhook", s.webhook || "");
  localStorage.setItem("sl_stations", JSON.stringify(s.stations || DEFAULT_STATIONS));
}

/* ---------------- Helpers ---------------- */
function pad(n){ return n.toString().padStart(2,"0"); }

function genRecordId(seq){
  const d = new Date();
  const yy = d.getFullYear().toString().slice(2);
  const mm = pad(d.getMonth()+1);
  return `SL-${yy}${mm}-${pad(seq)}`;
}

function fmtTime(ts){
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'});
  if(isToday) return `Today ${time}`;
  return `${d.toLocaleDateString('en-IN', {day:'2-digit', month:'short'})} ${time}`;
}

function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

function fileToDataUrl(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Resize/compress an image dataURL for both storage thumbnails and AI payload
function resizeImage(dataUrl, maxDim, quality){
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if(width > height && width > maxDim){ height = height * (maxDim/width); width = maxDim; }
      else if(height > maxDim){ width = width * (maxDim/height); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
}

function haversine(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ---------------- AI organize: dispatcher across providers ---------------- */
function buildOrganizePrompt(noteText, stationList){
  return `You are organizing a field site-observation record for a civil engineer working on metro construction sites in India. 
Given the photo (if any) and the note below, respond with ONLY a JSON object (no markdown, no preamble) with these exact keys:
{
  "title": "short 4-8 word title for this record",
  "cleaned_note": "the note rewritten clearly and concisely, fixing grammar, keeping all technical facts and numbers exactly as given. If the note is empty, briefly describe what's visible in the photo instead.",
  "category": "one of: Safety, Quality, Progress, Material, Issue, General",
  "suggested_station": "best-guess station/location name from this list if mentioned or implied, else empty string: ${stationList.join(", ")}"
}

Note from the engineer: "${noteText || "(no text note provided, describe the photo)"}"`;
}

function parseJsonFromModelText(text){
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

async function callAIOrganize({ provider, apiKey, model, noteText, imageDataUrl, stationList }){
  if(provider === "deepseek"){
    return callDeepSeekOrganize({ apiKey, model, noteText, imageDataUrl, stationList });
  }
  return callClaudeOrganize({ apiKey, model, noteText, imageDataUrl, stationList });
}

/* ---------------- Anthropic (BYOK, direct from browser) ---------------- */
async function callClaudeOrganize({ apiKey, model, noteText, imageDataUrl, stationList }){
  const content = [];
  if(imageDataUrl){
    const base64 = imageDataUrl.split(",")[1];
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: base64 }
    });
  }
  content.push({ type: "text", text: buildOrganizePrompt(noteText, stationList) });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 500,
      messages: [{ role: "user", content }]
    })
  });

  if(!res.ok){
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return parseJsonFromModelText(text);
}

/* ---------------- DeepSeek (BYOK, OpenAI-compatible endpoint) ----------------
   NOTE: unlike Anthropic, DeepSeek does not publicly document a browser-direct
   CORS opt-in header. This call may be blocked by the browser with a CORS
   error depending on DeepSeek's current server config. If that happens here,
   the fetch will reject with a generic "Failed to fetch" / network error —
   the fallback is to route this same request through a tiny proxy (e.g. a
   Cloudflare Worker) instead of calling api.deepseek.com directly.

   ALSO NOTE: DeepSeek's chat/completions endpoint currently rejects OpenAI's
   image_url content type ("unknown variant `image_url`, expected `text`"),
   despite some marketing claiming V4 vision support. Until DeepSeek exposes
   a working, documented image format on this endpoint, this provider is
   text-only — the photo itself is not sent, only your note text. */
async function callDeepSeekOrganize({ apiKey, model, noteText, imageDataUrl, stationList }){
  const promptText = buildOrganizePrompt(noteText, stationList) +
    (imageDataUrl ? "\n\n(A photo was attached but DeepSeek's API does not currently support image input here, so base your answer on the note text only. If the note is empty, use \"General\" as the category and a generic title like \"Site photo\" for the title.)" : "");

  let res;
  try{
    res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 500,
        messages: [{ role: "user", content: promptText }]
      })
    });
  }catch(networkErr){
    throw new Error("Network/CORS error calling DeepSeek directly from the browser. DeepSeek may be blocking browser-origin requests — see the note in Settings, or try the Anthropic provider instead.");
  }

  if(!res.ok){
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return parseJsonFromModelText(text);
}

/* ---------------- App State ---------------- */
let allRecords = [];
let currentCategoryFilter = "all";
let currentSearch = "";
let capturedPhotoDataUrl = null;   // full-res (for saving)
let capturedPhotoThumb = null;     // resized (for AI + thumbnail)
let aiResultData = null;
let editingRecordId = null;
let openDetailId = null;
let recognizing = false;
let recognition = null;

/* ---------------- Rendering ---------------- */
function renderStats(){
  const today = new Date().toDateString();
  document.getElementById("statTotal").textContent = allRecords.length;
  document.getElementById("statToday").textContent = allRecords.filter(r => new Date(r.timestamp).toDateString() === today).length;
  document.getElementById("statPending").textContent = allRecords.filter(r => r.syncStatus !== "synced").length;
  document.getElementById("entryCount").textContent = `${allRecords.length} ENTRIES`;
}

function updateSyncPill(){
  const s = getSettings();
  const dot = document.getElementById("syncDot");
  const txt = document.getElementById("syncText");
  const pending = allRecords.filter(r => r.syncStatus !== "synced").length;
  if(!s.webhook){
    dot.className = "sync-dot off"; txt.textContent = "LOCAL ONLY";
  } else if(pending === 0){
    dot.className = "sync-dot ok"; txt.textContent = "SYNCED";
  } else {
    dot.className = "sync-dot pending"; txt.textContent = `${pending} PENDING`;
  }
}

function renderRecords(){
  const list = document.getElementById("recordList");
  const empty = document.getElementById("emptyState");
  let filtered = allRecords;
  if(currentCategoryFilter !== "all"){
    filtered = filtered.filter(r => (r.category || "General") === currentCategoryFilter);
  }
  if(currentSearch.trim()){
    const q = currentSearch.trim().toLowerCase();
    filtered = filtered.filter(r =>
      (r.title||"").toLowerCase().includes(q) ||
      (r.cleanedNote||"").toLowerCase().includes(q) ||
      (r.rawNote||"").toLowerCase().includes(q) ||
      (r.station||"").toLowerCase().includes(q) ||
      (r.recordId||"").toLowerCase().includes(q)
    );
  }
  list.innerHTML = "";
  if(filtered.length === 0){
    empty.classList.remove("hidden");
  } else {
    empty.classList.add("hidden");
    for(const r of filtered){
      const el = document.createElement("div");
      el.className = "record";
      el.dataset.id = r.id;
      const cat = r.category || "General";
      el.innerHTML = `
        <img class="record-thumb" src="${r.thumb || ''}" onerror="this.style.opacity=0">
        <div class="record-body">
          <div class="record-top">
            <div class="record-title">${escapeHtml(r.title || "(untitled)")}</div>
            <div class="record-id">${r.recordId}</div>
          </div>
          <div class="record-note">${escapeHtml(r.cleanedNote || r.rawNote || "")}</div>
          <div class="record-meta">
            <span class="tag cat-${cat}">${cat}</span>
            ${r.station ? `<span class="tag tag-station">${escapeHtml(r.station)}</span>` : ""}
            <span class="tag tag-time">${fmtTime(r.timestamp)}</span>
          </div>
        </div>
        <span class="sync-corner" style="background:${r.syncStatus==='synced' ? 'var(--green)' : (r.syncStatus==='error' ? 'var(--red)' : 'var(--amber)')}"></span>
      `;
      el.addEventListener("click", () => openDetail(r.id));
      list.appendChild(el);
    }
  }
  renderStats();
  updateSyncPill();
}

function escapeHtml(str){
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

/* ---------------- Capture Sheet ---------------- */
function resetCaptureSheet(){
  capturedPhotoDataUrl = null;
  capturedPhotoThumb = null;
  aiResultData = null;
  editingRecordId = null;
  document.getElementById("photoPreview").classList.add("hidden");
  document.getElementById("photoPreview").src = "";
  document.getElementById("photoPlaceholder").classList.remove("hidden");
  document.getElementById("noteInput").value = "";
  document.getElementById("aiResult").classList.remove("show");
  document.getElementById("captureStatus").textContent = "";
  document.getElementById("captureStatus").className = "status-line";
  document.getElementById("captureSheetTitle").textContent = "New Record";
  populateStationSelect();
}

function populateStationSelect(){
  const s = getSettings();
  const sel = document.getElementById("stationSelect");
  sel.innerHTML = "";
  for(const st of s.stations){
    const opt = document.createElement("option");
    opt.value = st; opt.textContent = st;
    sel.appendChild(opt);
  }
}

function openCaptureSheet(){
  resetCaptureSheet();
  document.getElementById("captureOverlay").classList.add("open");
  // try to grab GPS quietly in background (used only as metadata)
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      (pos) => { openCaptureSheet._geo = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
      () => { openCaptureSheet._geo = null; },
      { timeout: 5000 }
    );
  }
}
function closeCaptureSheet(){
  document.getElementById("captureOverlay").classList.remove("open");
}

async function handlePhotoFile(file){
  if(!file) return;
  const dataUrl = await fileToDataUrl(file);
  capturedPhotoDataUrl = await resizeImage(dataUrl, 1600, 0.82);   // stored/full view
  capturedPhotoThumb = await resizeImage(dataUrl, 900, 0.7);       // sent to AI / thumbnail source
  document.getElementById("photoPreview").src = capturedPhotoDataUrl;
  document.getElementById("photoPreview").classList.remove("hidden");
  document.getElementById("photoPlaceholder").classList.add("hidden");
}

async function runAiOrganize(){
  const s = getSettings();
  const statusEl = document.getElementById("captureStatus");
  if(!s.apiKey){
    statusEl.textContent = "Add your Anthropic API key in Settings first.";
    statusEl.className = "status-line err";
    return;
  }
  const noteText = document.getElementById("noteInput").value.trim();
  if(!noteText && !capturedPhotoThumb){
    statusEl.textContent = "Add a photo or a note first.";
    statusEl.className = "status-line err";
    return;
  }
  const btn = document.getElementById("aiOrganizeBtn");
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner" style="border-top-color:var(--text)"></div> Thinking...`;
  statusEl.textContent = "";
  try{
    const result = await callAIOrganize({
      provider: s.provider,
      apiKey: s.apiKey,
      model: s.model,
      noteText,
      imageDataUrl: capturedPhotoThumb,
      stationList: s.stations
    });
    aiResultData = result;
    document.getElementById("aiTitleOut").textContent = result.title || "—";
    document.getElementById("aiNoteOut").textContent = result.cleaned_note || "—";
    const catRow = document.getElementById("aiCatOut");
    catRow.innerHTML = `<span class="tag cat-${result.category||'General'}">${result.category||'General'}</span>`;
    document.getElementById("aiResult").classList.add("show");
    if(result.suggested_station){
      const sel = document.getElementById("stationSelect");
      const match = Array.from(sel.options).find(o => o.value.toLowerCase() === result.suggested_station.toLowerCase());
      if(match) sel.value = match.value;
    }
    statusEl.textContent = "Organized. Review below, then Save.";
    statusEl.className = "status-line ok";
  }catch(err){
    statusEl.textContent = "AI error: " + err.message;
    statusEl.className = "status-line err";
  }finally{
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"></path></svg> Organize with AI`;
  }
}

async function saveRecord(){
  const noteText = document.getElementById("noteInput").value.trim();
  const station = document.getElementById("stationSelect").value;
  if(!capturedPhotoDataUrl && !noteText){
    const statusEl = document.getElementById("captureStatus");
    statusEl.textContent = "Add at least a photo or a note.";
    statusEl.className = "status-line err";
    return;
  }
  const seq = allRecords.length + 1;
  const geo = openCaptureSheet._geo || null;
  const record = {
    id: editingRecordId || (Date.now().toString(36) + Math.random().toString(36).slice(2,7)),
    recordId: genRecordId(seq),
    timestamp: Date.now(),
    photo: capturedPhotoDataUrl || null,
    thumb: capturedPhotoThumb || capturedPhotoDataUrl || null,
    rawNote: noteText,
    title: (aiResultData && aiResultData.title) || (noteText ? noteText.slice(0,40) : "Untitled record"),
    cleanedNote: (aiResultData && aiResultData.cleaned_note) || noteText,
    category: (aiResultData && aiResultData.category) || "General",
    station: station || "",
    lat: geo ? geo.lat : null,
    lng: geo ? geo.lng : null,
    syncStatus: "local"
  };
  await dbPut(record);
  allRecords = await dbGetAll();
  renderRecords();
  closeCaptureSheet();
  showToast(`Saved as ${record.recordId}`);

  // fire-and-forget background sync if webhook configured
  const s = getSettings();
  if(s.webhook){ syncRecord(record).catch(()=>{}); }
}

/* ---------------- Voice input (Web Speech API) ---------------- */
function initSpeech(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ document.getElementById("micBtn").style.display = "none"; return; }
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-IN";
  let baseText = "";
  recognition.onstart = () => { baseText = document.getElementById("noteInput").value.trim(); };
  recognition.onresult = (e) => {
    // Rebuild the transcript fresh from the FULL results list every time,
    // rather than appending onto an accumulator. Android Chrome sometimes
    // re-sends earlier "final" segments in continuous mode; accumulating
    // with += causes the text to duplicate and grow on every event.
    let final = "";
    let interim = "";
    for(let i = 0; i < e.results.length; i++){
      const t = e.results[i][0].transcript;
      if(e.results[i].isFinal) final += t + " ";
      else interim += t;
    }
    const combined = [baseText, (final + interim).trim()].filter(Boolean).join(" ");
    document.getElementById("noteInput").value = combined;
  };
  recognition.onerror = () => stopRecording();
  recognition.onend = () => stopRecording();
}
function startRecording(){
  if(!recognition) return;
  recognizing = true;
  document.getElementById("micBtn").classList.add("recording");
  try{ recognition.start(); }catch(e){}
}
function stopRecording(){
  recognizing = false;
  document.getElementById("micBtn").classList.remove("recording");
  try{ recognition.stop(); }catch(e){}
}

/* ---------------- Detail Sheet ---------------- */
function openDetail(id){
  const r = allRecords.find(x => x.id === id);
  if(!r) return;
  openDetailId = id;
  document.getElementById("detailRecordId").textContent = r.recordId;
  document.getElementById("detailPhoto").src = r.photo || r.thumb || "";
  document.getElementById("detailPhoto").style.display = (r.photo || r.thumb) ? "block" : "none";
  const body = document.getElementById("detailBody");
  body.innerHTML = `
    <div class="kv"><div class="kv-label">Title</div><div class="kv-val">${escapeHtml(r.title)}</div></div>
    <div class="kv"><div class="kv-label">Note</div><div class="kv-val">${escapeHtml(r.cleanedNote || r.rawNote || "—")}</div></div>
    <div class="kv"><div class="kv-label">Category</div><div class="kv-val"><span class="tag cat-${r.category}">${r.category}</span></div></div>
    <div class="kv"><div class="kv-label">Station</div><div class="kv-val">${escapeHtml(r.station || "—")}</div></div>
    <div class="kv"><div class="kv-label">Time</div><div class="kv-val">${new Date(r.timestamp).toLocaleString('en-IN')}</div></div>
    <div class="kv"><div class="kv-label">GPS</div><div class="kv-val">${r.lat ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}` : "—"}</div></div>
    <div class="kv"><div class="kv-label">Sync</div><div class="kv-val">${r.syncStatus}</div></div>
  `;
  document.getElementById("detailOverlay").classList.add("open");
}
function closeDetail(){
  document.getElementById("detailOverlay").classList.remove("open");
  openDetailId = null;
}

/* ---------------- Drive Sync (via Google Apps Script Web App) ---------------- */
async function syncRecord(record){
  const s = getSettings();
  if(!s.webhook) throw new Error("No sync URL configured");
  record.syncStatus = "pending";
  await dbPut(record);
  renderRecords();
  try{
    const res = await fetch(s.webhook, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight on Apps Script
      body: JSON.stringify({
        recordId: record.recordId,
        timestamp: record.timestamp,
        title: record.title,
        note: record.cleanedNote,
        rawNote: record.rawNote,
        category: record.category,
        station: record.station,
        lat: record.lat, lng: record.lng,
        photoBase64: record.photo ? record.photo.split(",")[1] : null
      })
    });
    const out = await res.json().catch(() => ({ ok: res.ok }));
    if(out.ok === false) throw new Error(out.error || "Sync failed");
    record.syncStatus = "synced";
    record.driveFileId = out.fileId || record.driveFileId;
  }catch(err){
    record.syncStatus = "error";
    throw err;
  }finally{
    await dbPut(record);
    allRecords = await dbGetAll();
    renderRecords();
  }
}

async function syncAllPending(){
  const s = getSettings();
  if(!s.webhook){ showToast("Add a Sync URL in Settings first."); return; }
  const pending = allRecords.filter(r => r.syncStatus !== "synced");
  if(pending.length === 0){ showToast("Everything is already synced."); return; }
  const statusEl = document.getElementById("settingsStatus");
  let ok = 0, fail = 0;
  for(const r of pending){
    statusEl.textContent = `Syncing ${r.recordId}...`;
    try{ await syncRecord(r); ok++; } catch(e){ fail++; }
  }
  statusEl.textContent = `Sync done: ${ok} succeeded, ${fail} failed.`;
  statusEl.className = fail ? "status-line err" : "status-line ok";
}

/* ---------------- Export ---------------- */
function exportJson(){
  const blob = new Blob([JSON.stringify(allRecords, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sitelog-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------- Settings Sheet ---------------- */
function refreshProviderUI(provider, selectedModel){
  const models = MODELS_BY_PROVIDER[provider] || MODELS_BY_PROVIDER.anthropic;
  const modelSelect = document.getElementById("modelSelect");
  modelSelect.innerHTML = "";
  for(const m of models){
    const opt = document.createElement("option");
    opt.value = m.value; opt.textContent = m.label;
    modelSelect.appendChild(opt);
  }
  if(selectedModel && models.some(m => m.value === selectedModel)){
    modelSelect.value = selectedModel;
  }

  const keyLabel = document.getElementById("apiKeyLabel");
  const keyHint = document.getElementById("apiKeyHint");
  const keyInput = document.getElementById("apiKeyInput");
  const warning = document.getElementById("deepseekWarning");

  if(provider === "deepseek"){
    keyLabel.textContent = "DeepSeek API Key (for AI organizing)";
    keyHint.textContent = "Stored only on this device. Get a key at platform.deepseek.com — much cheaper than Anthropic per record.";
    keyInput.placeholder = "sk-...";
    warning.textContent = "Note: DeepSeek is text-only here — its API currently rejects photo input, so only your note gets organized. Switch to Anthropic for photo-based organizing. Also unofficial for browser calls — may fail with a network error.";
    warning.className = "status-line err";
    warning.style.textAlign = "left";
  } else {
    keyLabel.textContent = "Anthropic API Key (for AI organizing)";
    keyHint.textContent = "Stored only on this device. Get a key at console.anthropic.com";
    keyInput.placeholder = "sk-ant-...";
    warning.textContent = "";
  }
}

function openSettings(){
  const s = getSettings();
  document.getElementById("providerSelect").value = s.provider;
  document.getElementById("apiKeyInput").value = s.apiKey;
  document.getElementById("webhookInput").value = s.webhook;
  document.getElementById("stationsInput").value = s.stations.join("\n");
  document.getElementById("settingsStatus").textContent = "";
  refreshProviderUI(s.provider, s.model);
  document.getElementById("settingsOverlay").classList.add("open");
}
function closeSettings(){
  document.getElementById("settingsOverlay").classList.remove("open");
}

/* ---------------- Wire up events ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  await openDB();
  allRecords = await dbGetAll();
  renderRecords();
  initSpeech();

  document.getElementById("captureCard").addEventListener("click", openCaptureSheet);
  document.getElementById("captureCloseBtn").addEventListener("click", closeCaptureSheet);
  document.getElementById("photoZone").addEventListener("click", () => document.getElementById("cameraInput").click());
  document.getElementById("retakeBtn").addEventListener("click", (e) => { e.stopPropagation(); document.getElementById("cameraInput").click(); });
  document.getElementById("galleryBtn").addEventListener("click", (e) => { e.stopPropagation(); document.getElementById("galleryInput").click(); });
  document.getElementById("cameraInput").addEventListener("change", (e) => handlePhotoFile(e.target.files[0]));
  document.getElementById("galleryInput").addEventListener("change", (e) => handlePhotoFile(e.target.files[0]));
  document.getElementById("micBtn").addEventListener("click", () => recognizing ? stopRecording() : startRecording());
  document.getElementById("aiOrganizeBtn").addEventListener("click", runAiOrganize);
  document.getElementById("saveRecordBtn").addEventListener("click", saveRecord);

  document.getElementById("detailCloseBtn").addEventListener("click", closeDetail);
  document.getElementById("detailSyncBtn").addEventListener("click", async () => {
    const r = allRecords.find(x => x.id === openDetailId);
    if(!r) return;
    try{ await syncRecord(r); showToast("Synced to Drive."); openDetail(r.id); }
    catch(e){ showToast("Sync failed: " + e.message); }
  });
  document.getElementById("detailDeleteBtn").addEventListener("click", async () => {
    if(!openDetailId) return;
    await dbDelete(openDetailId);
    allRecords = await dbGetAll();
    renderRecords();
    closeDetail();
    showToast("Record deleted.");
  });

  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("settingsCloseBtn").addEventListener("click", closeSettings);
  document.getElementById("providerSelect").addEventListener("change", (e) => {
    refreshProviderUI(e.target.value, null);
  });
  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    saveSettings({
      provider: document.getElementById("providerSelect").value,
      apiKey: document.getElementById("apiKeyInput").value.trim(),
      model: document.getElementById("modelSelect").value,
      webhook: document.getElementById("webhookInput").value.trim(),
      stations: document.getElementById("stationsInput").value.split("\n").map(s=>s.trim()).filter(Boolean)
    });
    document.getElementById("settingsStatus").textContent = "Settings saved.";
    document.getElementById("settingsStatus").className = "status-line ok";
    updateSyncPill();
  });
  document.getElementById("syncAllBtn").addEventListener("click", syncAllPending);
  document.getElementById("exportBtn").addEventListener("click", exportJson);

  document.getElementById("searchInput").addEventListener("input", (e) => {
    currentSearch = e.target.value;
    renderRecords();
  });
  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      currentCategoryFilter = chip.dataset.cat;
      renderRecords();
    });
  });

  // close sheets on overlay background tap
  document.querySelectorAll(".sheet-overlay").forEach(ov => {
    ov.addEventListener("click", (e) => { if(e.target === ov) ov.classList.remove("open"); });
  });

  // register service worker for offline installability
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
});
