// ============================
// Aither AI (animated)
// ============================

// The real Groq key lives in the Supabase Edge Function (secret GROQ_API_KEY).
// This value is only a placeholder; it is never sent to Groq.
const API_KEY = "proxy";

const MODEL_FAST  = "openai/gpt-oss-20b";
const MODEL_THINK = "openai/gpt-oss-120b";   // used when "Think" is on
const FENCE = "\u0060\u0060\u0060";
const GUIDE_EXAMPLE = '{"title":"🍪 Easy Chocolate Chip Cookies","image_queries":["chocolate chip cookies","cookie dough","baked cookies"],"stats":[{"icon":"clock","value":"25 minutes","label":"Total time"},{"icon":"servings","value":"12-18","label":"Cookies"},{"icon":"level","value":"Easy","label":"Difficulty"}],"ingredients_title":"Ingredients","ingredients":["1/2 cup butter, softened","1 egg"],"steps":[{"title":"Preheat the oven","text":"Set your oven to **350°F (175°C)**.","image_query":"oven temperature dial"}],"tips_title":"Tips for the best cookies","tips":["Do not overbake."],"closing":"Ready to enjoy! 🍪"}';
const GUIDE_RULES =
  "GUIDES: when the user asks how to do something, or wants step-by-step instructions, a tutorial, a recipe, or a setup or DIY walkthrough, reply with ONLY one fenced block that starts with " + FENCE + "guide and ends with " + FENCE + ", containing valid JSON and nothing else (no text before or after it). " +
  "Fields: title (start with one fitting emoji); image_queries (3 short, generic photo search phrases); stats (exactly 3 items, each with icon = clock, servings, level or cost, plus value and label); ingredients_title and ingredients (only if things are needed, otherwise omit); " +
  "steps (4 to 8 items, each with title, text and image_query of 2 to 4 concrete words; text is 1 to 2 sentences and may use **bold**); tips_title and tips (3 to 4 short tips); closing (a short cheerful line ending with one emoji). " +
  "Example:\n" + FENCE + "guide\n" + GUIDE_EXAMPLE + "\n" + FENCE + "\nFor anything that is not a how-to, answer normally.";

const LIST_EXAMPLE = '{"title":"Grocery List","sections":[{"title":"Produce","items":["Apples","Spinach"]},{"title":"Dairy","items":["Milk","Eggs"]}]}';
const LIST_RULES =
  "LISTS: when the user asks you to make or start a list for themselves to use and tick off (grocery or shopping list, to-do list, packing list, checklist and so on), reply with ONLY one fenced block that starts with " + FENCE + "list and ends with " + FENCE + ", containing valid JSON and nothing else. " +
  "Fields: title (a short name, no emoji); sections (2 to 5 sensible groups, each with a title and items, an array of short strings; for a short list use one section with an empty title). Items may also be objects with text and done. " +
  "Example:\n" + FENCE + "list\n" + LIST_EXAMPLE + "\n" + FENCE + "\nIf the user later asks you to add, remove or change items on a list, reply with the full updated list in the same format and keep each item's done state. " +
  "Do not use this for informational lists, for example 'list 5 facts about dogs'; answer those normally.";

const SYSTEM_BASE = "You are Aither AI, a friendly, concise, helpful AI assistant. " +
  "Format answers cleanly with markdown: short paragraphs, a few ## headings for longer answers, and simple bullet or numbered lists. " +
  "Do not use tables unless the user asks for a comparison; if you do, keep it to 3 columns or fewer with short cells, and never put bullet points or line breaks inside table cells. " +
  "Avoid walls of text, and do not over-use emojis or bold. ";
const SYSTEM = SYSTEM_BASE + GUIDE_RULES + " " + LIST_RULES;   // buildSystem() (settings section) adds the user's settings on top of this

const $ = id => document.getElementById(id);
const app = $("app"), stage = $("stage"), msgsEl = $("msgs"), input = $("input");
const sendBtn = $("send"), errEl = $("err"), composerWrap = $("composerWrap");
const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- rotating welcome message (words animate in) ----------
const WELCOME_MESSAGES = [
  "Ready when you are.",
  "What would you like to explore?",
  "Where should we start?",
  "I'm here. What's on your mind?",
  "Let's figure something out.",
  "What can I help you with today?",
  "A new conversation starts here.",
  "Go ahead. I'm listening."
];

function setWelcomeMessage(){
  const hero = $("hero");
  let previous = -1;
  try{ previous = Number(localStorage.getItem("astra_last_welcome_index")); }catch(e){}
  if(!Number.isInteger(previous) || previous < 0 || previous >= WELCOME_MESSAGES.length) previous = -1;

  let next = Math.floor(Math.random() * WELCOME_MESSAGES.length);
  while(WELCOME_MESSAGES.length > 1 && next === previous){
    next = Math.floor(Math.random() * WELCOME_MESSAGES.length);
  }

  hero.textContent = "";
  WELCOME_MESSAGES[next].split(" ").forEach((word,i,arr)=>{
    const s = document.createElement("span");
    s.className = "w";
    s.style.animationDelay = (0.12 + i*0.09) + "s";
    s.textContent = word + (i < arr.length-1 ? " " : "");
    hero.appendChild(s);
  });
  try{ localStorage.setItem("astra_last_welcome_index", String(next)); }catch(e){}
}

// ---------- storage (safe: web views can block it) ----------
let mem = [];
let localChatOwner = null;
function localChatStorageKey(){ return localChatOwner ? "aither_ai_chats_" + localChatOwner : "astra_chats"; }
function load(){ try{ return JSON.parse(localStorage.getItem(localChatStorageKey())||"[]"); }catch(e){ return mem; } }
function save(){ try{ localStorage.setItem(localChatStorageKey(), JSON.stringify(chats)); }catch(e){ mem = chats; } queueCloud(); }

let chats = load();
chats.forEach(c=>{ c.messages = (c.messages || []).filter(m=> !(m.role === "assistant" && /^\[generated an image\]$/i.test((m.content || "").trim()))); });
// ---------- Supabase: AI proxy + chat sync ----------
async function groqFetch(path, init){
  if(!sb) throw new Error("Not connected to Supabase.");
  const s = await sb.auth.getSession(), tok = s.data && s.data.session && s.data.session.access_token;
  if(!tok) throw new Error("Please sign in with Aither Sign In to use Aither AI.");
  const h = new Headers((init && init.headers) || {}); h.set("Authorization", "Bearer " + tok); h.set("apikey", SUPABASE_KEY);
  return fetch(SUPABASE_URL + "/functions/v1/groq/" + path, Object.assign({}, init, { headers:h }));
}

// ---------- AI provider routing (server-managed credentials) ----------
const AI_PROVIDER_STORE = "aither_ai_provider_settings_v2";
const AI_BACKEND_URL = window.AitherConfig.backendUrl;
const AI_PROVIDER_OPTIONS = [
  ["gemini", "Google Gemini"],
  ["pollinations", "Pollinations AI"],
  ["openrouter", "OpenRouter"],
  ["mincapi", "MincAPI"],
  ["llama4", "Meta Llama 4"],
  ["llama3", "Meta Llama 3"]
];
const AI_PROVIDER_DEFAULTS = { provider: "gemini", model: "" };
let aiProviderSettings = Object.assign({}, AI_PROVIDER_DEFAULTS);
let AI_PROVIDER_MODELS = null;
let AI_MODELS_LOADING = false;
function readAIProviderSettings() {
  try {
    const raw = JSON.parse(safeStorage.getItem(AI_PROVIDER_STORE) || "{}");
    return {
      provider: AI_PROVIDER_OPTIONS.some(([id]) => id === raw.provider) ? raw.provider : "gemini",
      model: String(raw.model || "")
    };
  } catch (_) {
    return Object.assign({}, AI_PROVIDER_DEFAULTS);
  }
}
function saveAIProviderSettings() {
  aiProviderSettings.provider = $("aiProvider").value;
  aiProviderSettings.model = $("aiModel").value;
  safeStorage.setItem(AI_PROVIDER_STORE, JSON.stringify(aiProviderSettings));
  $("aiProviderStatus").textContent = "Saved on this device · API keys stay on Render";
  toast("AI provider settings saved.");
}
function normalizeProviderModels(items) {
  return (Array.isArray(items) ? items : []).map(item => {
    if (typeof item === "string") return { id: item, name: item };
    if (!item || typeof item !== "object") return null;
    const id = String(item.id || item.model || item.name || "");
    return id ? { id, name: String(item.name || item.title || id) } : null;
  }).filter(Boolean);
}
async function loadAIProviderModels() {
  if (AI_MODELS_LOADING) return;
  AI_MODELS_LOADING = true;
  $("aiProviderStatus").textContent = "Connecting to AitherBackend on Render…";
  try {
    const data = await window.AitherAPI.models();
    AI_PROVIDER_MODELS = data.providers || {};
    const currentAvailable = normalizeProviderModels(AI_PROVIDER_MODELS[aiProviderSettings.provider]);
    if (!currentAvailable.length) {
      const first = AI_PROVIDER_OPTIONS.find(([id]) => normalizeProviderModels(AI_PROVIDER_MODELS[id]).length);
      if (first) aiProviderSettings.provider = first[0];
    }
    renderAIProviderSettings();
    $("aiProviderStatus").textContent = "Connected to AitherBackend · provider catalog loaded";
  } catch (error) {
    AI_PROVIDER_MODELS = {};
    $("aiProviderStatus").textContent = error.message || "AitherBackend is unavailable.";
    renderAIProviderSettings();
  } finally {
    AI_MODELS_LOADING = false;
  }
}
function fillAIModelOptions(models, selected) {
  const sel = $("aiModel");
  sel.innerHTML = "";
  if (!models.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No configured models available";
    sel.appendChild(option);
    aiProviderSettings.model = "";
    return;
  }
  models.forEach(model => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name;
    sel.appendChild(option);
  });
  sel.value = models.some(model => model.id === selected) ? selected : models[0].id;
  aiProviderSettings.model = sel.value;
}
function renderAIProviderSettings() {
  const select = $("aiProvider");
  const selectedProvider = AI_PROVIDER_OPTIONS.some(([id]) => id === aiProviderSettings.provider)
    ? aiProviderSettings.provider : "gemini";
  select.value = selectedProvider;
  const models = normalizeProviderModels(AI_PROVIDER_MODELS && AI_PROVIDER_MODELS[selectedProvider]);
  fillAIModelOptions(models, aiProviderSettings.model);
  $("aiModelHint").textContent = models.length
    ? models.length + " server-approved model(s). Provider credentials are managed securely on Render."
    : AI_MODELS_LOADING ? "Loading models from AitherBackend…" : "No models returned. Check the provider's Render environment settings.";
  if (!AI_PROVIDER_MODELS && !AI_MODELS_LOADING) loadAIProviderModels();
}
function selectedAIModel() {
  return $("aiModel")?.value || aiProviderSettings.model || "";
}
async function aiFetch(_path, init) {
  const payload = JSON.parse((init && init.body) || "{}");
  const provider = $("aiProvider").value || aiProviderSettings.provider;
  const model = selectedAIModel();
  const messages = (payload.messages || []).map(message => {
    if (Array.isArray(message.content)) {
      return { role: message.role, content: message.content };
    }
    return { role: message.role, content: String(message.content || "") };
  });
  if (!model) throw new Error("No model is available for this provider. Check its configuration in Render.");
  return window.AitherAPI.chat({ provider, model, messages, stream: !!payload.stream });
}
const cloud = { uid:null, ready:false, busy:false, timer:null, ids:new Set(), snap:new Map() };
const chatSnap = c=> JSON.stringify([c.title, !!c.archived, c.messages]);
function queueCloud(){ if(!cloud.ready) return; clearTimeout(cloud.timer); cloud.timer = setTimeout(pushChats, 1200); }
async function pullChats(){
  const uid = user && user.id;
  try{
    const r = await sb.from("aither_ai_chats").select("id,title,archived,messages").order("updated_at", { ascending:true });
    if(r.error) throw r.error;
    if(!user || user.id !== uid) return;
    const localById = new Map(chats.map(c=> [String(c.id), c]));
    const remoteChats = r.data.map(x=> ({ id:isFinite(Number(x.id)) ? Number(x.id) : x.id, title:x.title, archived:x.archived, messages:x.messages || [] }));
    // Remote copies win for matching IDs; local-only chats remain and are uploaded below.
    remoteChats.forEach(c=> localById.set(String(c.id), c));
    chats = Array.from(localById.values());
    cloud.ids = new Set(r.data.map(x=> String(x.id)));
    cloud.snap = new Map(remoteChats.map(c=> [String(c.id), chatSnap(c)]));
    try{ localStorage.setItem(localChatStorageKey(), JSON.stringify(chats)); }catch(e){}
    current = newChatObj(); renderChat();
    cloud.ready = true;
    queueCloud();   // uploads any chats that only exist on this device
  }catch(e){ toast("Couldn't load your saved chats."); }
}
async function pushChats(){
  if(!sb || !user || !cloud.ready) return;
  if(cloud.busy){ queueCloud(); return; }
  cloud.busy = true;
  try{
    const live = new Set(chats.filter(c=> c.messages.length).map(c=> String(c.id)));
    const gone = Array.from(cloud.ids).filter(id=> !live.has(id));
    if(gone.length){
      const d = await sb.from("aither_ai_chats").delete().in("id", gone); if(d.error) throw d.error;
      gone.forEach(id=>{ cloud.ids.delete(id); cloud.snap.delete(id); });
    }
    for(const c of chats){
      if(!c.messages.length) continue;
      const id = String(c.id), s = chatSnap(c);
      if(cloud.snap.get(id) === s) continue;
      const u = await sb.from("aither_ai_chats").upsert({ id:id, user_id:user.id, title:c.title || "New chat", archived:!!c.archived, messages:c.messages, updated_at:new Date().toISOString() }, { onConflict:"user_id,id" });
      if(u.error) throw u.error;
      cloud.snap.set(id, s); cloud.ids.add(id);
    }
  }catch(e){ toast("Couldn't sync chats. Retrying soon."); setTimeout(queueCloud, 15000); }
  cloud.busy = false;
}
function resetCloud(){ clearTimeout(cloud.timer); cloud.uid = null; cloud.ready = false; cloud.ids = new Set(); cloud.snap = new Map(); }

let current = null;
let busy = false;
let thinkOn = false;
const seenChats = new Set();   // so sidebar rows only animate in once

function newChatObj(){ return {id:Date.now() + Math.random(), title:"New chat", messages:[]}; }

// ---------- animation helper: composer glides between centered and docked ----------
function setEmpty(empty){
  const was = stage.classList.contains("empty");
  if(was === empty) return;
  const first = composerWrap.getBoundingClientRect();
  stage.classList.toggle("empty", empty);
  if(reduced) return;
  const last = composerWrap.getBoundingClientRect();
  const dy = first.top - last.top;
  if(!dy) return;
  composerWrap.style.transition = "none";
  composerWrap.style.transform = "translateY(" + dy + "px)";
  composerWrap.getBoundingClientRect();
  composerWrap.style.transition = "transform .55s cubic-bezier(.2,.8,.2,1)";
  composerWrap.style.transform = "";
}

// ---------- rendering ----------
try{
  DOMPurify.addHook("afterSanitizeAttributes", n=>{
    if(n.tagName === "A"){ n.setAttribute("target","_blank"); n.setAttribute("rel","noopener noreferrer"); }
  });
}catch(e){}
function md(text){
  try{
    const html = DOMPurify.sanitize(marked.parse(text, { gfm:true }));
    return html.replace(/<table/g, '<div class="tbl"><table').replace(/<\/table>/g, "</table></div>");
  }
  catch(e){ const d=document.createElement("div"); d.textContent=text; return d.innerHTML; }
}
// ---------- guide cards (step-by-step answers) ----------
const GUIDE_IMAGES = true;        // photos at the top of a guide
const GUIDE_STEP_IMAGES = true;   // small photo beside each step (set false if results look off-topic)

function blockKind(t){
  const s = t.trimStart();
  if(s.startsWith("```guide")) return "guide";
  if(s.startsWith("```list")) return "list";
  if(s.startsWith("```image")) return "image";
  if(s.length > 0 && s.length < 8 && ("```guide".startsWith(s) || "```list".startsWith(s) || "```image".startsWith(s))) return "pending";
  return null;
}
function isGuideText(t){ return !!blockKind(t); }   // true for any card block (guide, list or image)

// ---------- interactive lists ----------
function parseList(t){
  try{
    let x = t.trim().replace(/^```list\s*/, "");
    x = x.slice(x.indexOf("{"), x.lastIndexOf("}") + 1);
    const j = JSON.parse(x);
    let secs = Array.isArray(j.sections) ? j.sections : [{ title:"", items:j.items || [] }];
    secs = secs.map(sc=>({
      title: String(sc.title || ""),
      items: (sc.items || []).map(i=> typeof i === "string" ? { t:i, d:false } : { t:String(i.text || i.t || ""), d:!!(i.done || i.d) }).filter(i=> i.t)
    }));
    if(!secs.length) secs = [{ title:"", items:[] }];
    return { title:String(j.title || "My list").replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "") || "My list", sections:secs };
  }catch(e){ return null; }
}

const LIST_ICON = '<svg class="lst-ico" viewBox="0 0 108 100" aria-hidden="true">' +
  '<rect x="0" y="8.4" width="85.5" height="91" rx="10" fill="currentColor"/>' +
  '<rect x="7.5" y="23.5" width="71" height="68.3" rx="4.5" style="fill:var(--bg)"/>' +
  '<g style="fill:currentColor;stroke:var(--bg);stroke-width:2.6"><rect x="17.6" y="0.6" width="8.4" height="17.6" rx="4.2"/><rect x="38.8" y="0.6" width="8.4" height="17.6" rx="4.2"/><rect x="59.8" y="0.6" width="8.4" height="17.6" rx="4.2"/></g>' +
  '<g fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 39.4l4.2 4 8-8.4"/><path d="M16.5 57l4.2 4 8-8.4"/><path d="M16.5 74.7l4.2 4 8-8.4"/></g>' +
  '<g stroke="currentColor" stroke-width="5.8" stroke-linecap="round"><path d="M39.5 39.4H67"/><path d="M39.5 57H60.5"/><path d="M39.5 74.7H50.5"/></g>' +
  '<g transform="translate(55.5 88) rotate(-52.6)"><g style="fill:currentColor;stroke:var(--bg);stroke-width:3;stroke-linejoin:round;paint-order:stroke"><path d="M0 0L13 -8H52V8H13Z"/><rect x="56" y="-8" width="11" height="16" rx="5"/></g><path d="M3.8 0L10.5 -4.2V4.2Z" style="fill:var(--bg)"/></g></svg>';

function renderList(bubble, data){
  const root = el("div", "guide lst");
  function commit(){
    const m = bubble._msg; if(!m) return;
    m.content = FENCE + "list\n" + JSON.stringify({
      title:data.title,
      sections:data.sections.map(sc=>({ title:sc.title, items:sc.items.map(i=>({ text:i.t, done:i.d })) }))
    }) + "\n" + FENCE;
    save();
  }
  function draw(focusSec){
    root.innerHTML = "";
    const all = data.sections.reduce((a, sc)=> a.concat(sc.items), []);
    const done = all.filter(i=> i.d).length;
    const head = el("div", "lst-head", LIST_ICON);
    const ti = el("input", "lst-title"); ti.type = "text"; ti.value = data.title; ti.maxLength = 60; ti.setAttribute("aria-label", "List name");
    ti.addEventListener("change", ()=>{ data.title = ti.value.trim() || "My list"; ti.value = data.title; commit(); });
    ti.addEventListener("keydown", e=>{
      if(e.key === "Enter"){ e.preventDefault(); ti.blur(); }
      if(e.key === "Escape"){ ti.value = data.title; ti.blur(); }
    });
    const ed = el("button", "lst-edit", '<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>');
    ed.setAttribute("aria-label", "Rename list"); ed.onclick = ()=>{ ti.focus(); ti.select(); };
    head.append(ti, ed); root.appendChild(head);
    root.appendChild(txt("div", "lst-meta", all.length ? done + " of " + all.length + " done" : "Nothing here yet. Add your first item below."));
    const bar = el("div", "lst-bar", "<i></i>");
    bar.firstChild.style.width = (all.length ? done / all.length * 100 : 0) + "%";
    root.appendChild(bar);
    data.sections.forEach((sec, si)=>{
      if(sec.title) root.appendChild(txt("h3", "lst-sec", sec.title));
      sec.items.forEach((it, ii)=>{
        const row = el("div", "lst-item" + (it.d ? " done" : ""));
        const chk = el("button", "lst-chk", '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>');
        chk.setAttribute("aria-label", "Mark done");
        const t = txt("span", "lst-t", it.t);
        const toggle = ()=>{ it.d = !it.d; commit(); draw(); };
        chk.onclick = toggle; t.onclick = toggle;
        const del = el("button", "lst-del", '<svg viewBox="0 0 24 24" style="width:16px;height:16px"><path d="M6 6l12 12M18 6L6 18"/></svg>');
        del.setAttribute("aria-label", "Remove item");
        del.onclick = ()=>{ sec.items.splice(ii, 1); commit(); draw(); };
        row.append(chk, t, del); root.appendChild(row);
      });
      const add = el("div", "lst-add", '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>');
      const inp = el("input"); inp.type = "text"; inp.placeholder = "Add item"; inp.setAttribute("enterkeyhint", "done");
      inp.addEventListener("keydown", e=>{
        if(e.key !== "Enter") return;
        e.preventDefault();
        const v = inp.value.trim(); if(!v) return;
        sec.items.push({ t:v, d:false }); commit(); draw(si);
      });
      add.appendChild(inp); root.appendChild(add);
      if(focusSec === si) setTimeout(()=> inp.focus(), 0);
    });
    const foot = el("div", "lst-foot");
    if(done){
      const b = txt("button", "lst-btn", "Clear completed");
      b.onclick = ()=>{ data.sections.forEach(sc=>{ sc.items = sc.items.filter(i=> !i.d); }); commit(); draw(); };
      foot.appendChild(b);
    }
    if(all.length){
      const b = txt("button", "lst-btn", "Copy list");
      b.onclick = async ()=>{
        const out = data.title + "\n" + data.sections.map(sc=> (sc.title ? "\n" + sc.title + "\n" : "") + sc.items.map(i=> (i.d ? "[x] " : "[ ] ") + i.t).join("\n")).join("\n");
        try{ await navigator.clipboard.writeText(out); toast("List copied"); }catch(e){ toast("Couldn't copy here"); }
      };
      foot.appendChild(b);
    }
    if(foot.children.length) root.appendChild(foot);
  }
  draw();
  bubble.innerHTML = ""; bubble.appendChild(root);
}
function parseGuide(t){
  try{
    let s = t.trim().replace(/^```guide\s*/, "");
    s = s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1);
    const j = JSON.parse(s);
    return (j && typeof j === "object" && (j.steps || j.title)) ? j : null;
  }catch(e){ return null; }
}
function inl(t){ try{ return DOMPurify.sanitize(marked.parseInline(String(t || ""))); }catch(e){ return ""; } }
function el(tag, cls, html){ const e = document.createElement(tag); if(cls) e.className = cls; if(html != null) e.innerHTML = html; return e; }
function txt(tag, cls, t){ const e = el(tag, cls); e.textContent = t; return e; }

// Free photo lookup (lead photos of Wikipedia articles). Swap this one function to use another image source.
const imgCache = new Map();
function findImages(q, n){
  const key = q + "|" + n;
  if(imgCache.has(key)) return imgCache.get(key);
  const p = (async ()=>{
    try{
      const ctrl = new AbortController(), to = setTimeout(()=>ctrl.abort(), 7000);
      const url = "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=8&gsrsearch=" + encodeURIComponent(q) + "&prop=pageimages&piprop=thumbnail&pithumbsize=640";
      const r = await fetch(url, { signal:ctrl.signal }); clearTimeout(to);
      const j = await r.json();
      const pages = Object.values((j.query && j.query.pages) || {}).sort((a,b)=> a.index - b.index);
      return pages.map(x=> x.thumbnail).filter(t=> t && t.source && !/\.svg/i.test(t.source) && t.width >= 300).map(t=> t.source).slice(0, n);
    }catch(e){ return []; }
  })();
  imgCache.set(key, p);
  return p;
}

const G_ICONS = {
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  servings:'<circle cx="12" cy="12" r="9"/><path d="M9 9h.01M14 8h.01M15 13h.01M10 15h.01M12 12h.01"/>',
  level:'<path d="M6 15a4 4 0 112.2-7.3A4.5 4.5 0 0117 8.5 3.5 3.5 0 0118 15z"/><path d="M7 15v5h10v-5"/>',
  cost:'<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5A2.5 2 0 0012 8c-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2a2.5 2 0 01-2.5-1.5M12 6.5V8M12 16v1.5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
};

function renderGuide(bubble, g){
  const root = el("div", "guide");
  if(g.title) root.appendChild(txt("h2", "g-title", String(g.title)));
  if(g.intro) root.appendChild(el("p", "g-intro", inl(g.intro)));

  // photo collage
  const qs = (g.image_queries || []).filter(Boolean).slice(0, 3);
  if(GUIDE_IMAGES && qs.length){
    const gal = el("div", "g-gallery"); gal.style.display = "none"; root.appendChild(gal);
    const jobs = qs.length > 1 ? qs.map(q=> findImages(q, 1)) : [findImages(qs[0], 3)];
    Promise.all(jobs).then(r=>{
      const urls = Array.from(new Set([].concat.apply([], r))).slice(0, 3);
      if(!urls.length) return;
      gal.dataset.n = urls.length;
      urls.forEach(u=>{ const im = new Image(); im.alt = ""; im.onerror = ()=> im.remove(); im.src = u; gal.appendChild(im); });
      gal.style.display = "";
    });
  }

  // quick facts
  const st = (g.stats || []).slice(0, 3);
  if(st.length){
    const row = el("div", "g-stats"); row.style.gridTemplateColumns = "repeat(" + st.length + ",1fr)";
    st.forEach(s=>{
      const c = el("div", "g-stat", '<svg viewBox="0 0 24 24">' + (G_ICONS[s.icon] || G_ICONS.info) + "</svg>");
      c.appendChild(txt("b", "", String(s.value || ""))); c.appendChild(txt("span", "", String(s.label || "")));
      row.appendChild(c);
    });
    root.appendChild(row);
  }

  // ingredients / materials (tap to tick off)
  if((g.ingredients || []).length){
    root.appendChild(txt("h3", "g-h", g.ingredients_title || "Ingredients"));
    const ul = el("ul", "g-ing");
    g.ingredients.forEach(t=>{ const li = el("li", null, inl(t)); li.onclick = ()=> li.classList.toggle("done"); ul.appendChild(li); });
    root.appendChild(ul);
  }

  // steps
  const steps = g.steps || [];
  if(steps.length){
    root.appendChild(txt("h3", "g-h", g.steps_title || "Instructions"));
    const wrap = el("div", "g-steps");
    steps.forEach((s, i)=>{
      const row = el("div", "g-step"); row.style.animationDelay = Math.min(i, 8) * 0.06 + "s";
      if(GUIDE_STEP_IMAGES && s.image_query){
        const im = new Image(); im.className = "g-simg"; im.alt = ""; im.style.display = "none";
        im.onload = ()=>{ im.style.display = ""; }; im.onerror = ()=> im.remove();
        row.appendChild(im);
        findImages(s.image_query, 1).then(u=>{ if(u[0]) im.src = u[0]; else im.remove(); });
      }
      const body = el("div", "g-sb");
      const title = String(s.title || "").replace(/^\s*\d+[.)]\s*/, "");
      body.appendChild(txt("h3", null, (i + 1) + ". " + title));
      body.appendChild(el("p", null, inl(s.text)));
      row.appendChild(body); wrap.appendChild(row);
    });
    root.appendChild(wrap);
  }

  // tips
  if((g.tips || []).length){
    root.appendChild(txt("h3", "g-h", g.tips_title || "Tips"));
    const ul = el("ul", "g-tips"); g.tips.forEach(t=> ul.appendChild(el("li", null, inl(t))));
    root.appendChild(ul);
  }

  // closing badge
  if(g.closing){
    const c = String(g.closing), m = c.match(/^(.*?)\s*(\p{Extended_Pictographic}[\s\S]*)?$/u);
    const d = el("div", "g-done"); d.appendChild(txt("span", "g-badge", (m && m[1]) || c));
    if(m && m[2]) d.appendChild(txt("span", "", m[2]));
    root.appendChild(d);
  }
  bubble.innerHTML = ""; bubble.appendChild(root);
}

// ---------- image generation (AI Horde: free community network, no key, queue-based) ----------
const HORDE = "https://aihorde.net/api/v2";
const HORDE_HEADERS = { "Content-Type":"application/json", "apikey":"0000000000", "Client-Agent":"aither-ai:1.0:anonymous" };   // 0000000000 = anonymous
const sleep = ms => new Promise(r=> setTimeout(r, ms));

function imageSubject(t){
  return t.replace(/^\/(image|imagine|img)\b/i, "")
    .replace(/\b(please|can you|could you|generate|create|make|draw|paint|sketch|design|render|produce|me|an?|the|some|new|random|any|image|images|picture|pictures|photo|photos|illustration|drawing|painting|artwork|logo|wallpaper|poster|icon|portrait|of|for)\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ").trim();
}
function isImageRequest(t){
  const q = String(t || "").trim();
  if(/^\/(image|imagine|img)\b/i.test(q)) return true;

  // Accept natural requests including "make an image" and "make me an image of...".
  const lead = /^(?:(?:please|hey)\s+)?(?:(?:can|could|would)\s+you\s+)?(?:(?:i\s+want|i'd\s+like|i\s+would\s+like)\s+(?:you\s+to\s+)?)?(?:please\s+)?(?:generate|create|make|draw|paint|sketch|design|render|produce)\b/i;
  const visual = /\b(?:image|picture|photo|photograph|illustration|drawing|painting|artwork|logo|wallpaper|poster|icon|portrait)\b/i;
  if(lead.test(q) && visual.test(q)) return true;
  if(/^(?:please\s+)?(?:draw|paint|sketch)\s+(?:me\s+)?(?:an?|the|some)?\s*[\w]/i.test(q)) return true;
  return false;
}
// ---------- image editing detection ----------
const EDIT_CUE = /\b(make|turn|change|add|remove|replace|swap|put|give|set|paint|colou?r|recolou?r|fix|adjust|edit|redo|remake|try again|instead|rather|background|brighter|darker|bigger|smaller|more|less|without|but|wanted|meant|style|realistic|photoreal\w*|hyperreal\w*|cartoon\w*|pastel|pink|red|blue|green|yellow|purple|orange|black|white|sunset|night)\b/i;

function isImageEdit(t){
  const q = String(t || "").trim().toLowerCase();
  if(!q || /^\/(image|imagine|img)\b/.test(q)) return false;
  if(q.split(/\s+/).length > 30) return false;
  // "make a cat", "draw an owl" = a brand new image
  if(/\b(make|draw|create|generate|paint|design|render|produce|sketch)\s+(me\s+)?(an?|some)\s/.test(q)) return false;
  if(/\b(new|another|different|other|fresh)\s+(image|picture|photo|one)\b/.test(q)) return false;
  if(/\b(image|picture|photo|drawing|illustration|logo|poster)\s+(of|about|showing|depicting)\b/.test(q)) return false;
  return EDIT_CUE.test(q);
}

function latestImageMessage(chat){
  for(let i = chat.messages.length - 1; i >= 0; i--){
    const m = chat.messages[i];
    if(m.role !== "assistant") continue;
    const c = typeof m.content === "string" ? m.content : "";
    if(/^\[generated an image\]$/i.test(c.trim())) continue;   // junk from older versions
    if(c.indexOf(FENCE + "image") === 0) return parseImage(c);
    return null;
  }
  return null;
}
function parseImage(t){
  try{
    let s = t.trim().replace(/^```image\s*/, "");
    s = s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1);
    const j = JSON.parse(s);
    const ok = j && typeof j.prompt === "string" && typeof j.url === "string" &&
      (/^data:image\/(jpeg|png|webp);base64,/.test(j.url) || /^https:\/\//.test(j.url));
    return ok ? j : null;
  }catch(e){ return null; }
}
// Strips instruction text that older versions saved as the "prompt"
function cleanPrompt(p){
  let s = String(p || "").trim();
  const m = s.match(/Original image prompt:\s*([\s\S]*?)\.\s*User's correction/i);
  if(m) s = m[1].trim();
  s = s.replace(/^EDIT THE EXISTING IMAGE[^.]*\.\s*/i, "").replace(/^prompt\s*:\s*/i, "").replace(/^["'`]+|["'`]+$/g, "").trim();
  return s.slice(0, 400);
}

async function toDataUrl(src){
  if(!/^https?:/.test(src)) return "data:image/webp;base64," + src;
  try{
    const b = await (await fetch(src)).blob();
    const bmp = await createImageBitmap(b);
    const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext("2d").drawImage(bmp, 0, 0);
    return cv.toDataURL("image/jpeg", 0.9);
  }catch(e){ return src; }
}

const NEG_PROMPT = "blurry, low quality, deformed, disfigured, extra limbs, bad anatomy, text, watermark, signature, cropped";
const EDIT_STRENGTH = 0.68;   // lower = closer to original image, higher = bigger change

async function hordeImage(prompt, ui, sourceImage){
  const t0 = Date.now();
  const request = {
    prompt: prompt + " ### " + NEG_PROMPT, nsfw:false, censor_nsfw:true, r2:true,
    params:{ width:512, height:512, steps:30, cfg_scale:7.5, sampler_name:"k_euler_a", karras:true, n:1 }
  };
  if(sourceImage){
    if(/^data:image\/(?:jpeg|png|webp);base64,/i.test(sourceImage)) request.source_image = sourceImage.slice(sourceImage.indexOf(",") + 1);
    else if(/^https:\/\//i.test(sourceImage)) request.source_image = sourceImage;
    else throw new Error("source image unavailable");
    request.source_processing = "img2img";
    request.params.denoising_strength = EDIT_STRENGTH;
  }
  const start = await fetch(HORDE + "/generate/async", { method:"POST", headers:HORDE_HEADERS, body:JSON.stringify(request) });
  const sj = await start.json().catch(()=> ({}));
  if(!start.ok || !sj.id) throw new Error(start.status === 429 ? "busy" : (sj.message || ("Horde error " + start.status)));
  const id = sj.id;
  let fails = 0;
  while(true){
    if(Date.now() - t0 > 300000){
      try{ fetch(HORDE + "/generate/status/" + id, { method:"DELETE", headers:HORDE_HEADERS }); }catch(e){}
      throw new Error("timeout");
    }
    await sleep(2500);
    let c;
    try{ c = await (await fetch(HORDE + "/generate/check/" + id)).json(); fails = 0; }
    catch(e){ if(++fails > 5) throw new Error("network"); continue; }
    if(c.faulted) throw new Error("faulted");
    if(c.is_possible === false) throw new Error("busy");
    const el = (Date.now() - t0) / 1000, wait = Math.max(c.wait_time || 0, 1);
    ui.set(Math.min(95, el / (el + wait) * 100), c.queue_position > 0 ? "In queue: " + c.queue_position : "Creating image");
    if(c.done) break;
  }
  const s = await (await fetch(HORDE + "/generate/status/" + id)).json();
  const g = s.generations && s.generations[0];
  if(!g || !g.img) throw new Error("no image");
  if(g.censored) throw new Error("censored");
  return await toDataUrl(g.img);
}
function hordeMsg(e){
  const m = String((e && e.message) || "");
  if(m === "timeout" || m === "busy") return "The image queue is busy right now. Please try again in a moment.";
  if(m === "censored") return "That prompt was filtered. Try describing something different.";
  if(m === "source image unavailable") return "I couldn't access the previous image to edit it. Please try again.";
  return "Couldn't generate the image. Please try again.";
}
function genUI(bubble){
  bubble.innerHTML = '<div class="img-gen"><div class="ig-label">Creating image</div><div class="ig-wrap"><div class="ig-grid"></div><div class="ig-pct">0%</div></div></div>';
  const grid = bubble.querySelector(".ig-grid"), pct = bubble.querySelector(".ig-pct"), label = bubble.querySelector(".ig-label");
  let h = "";
  for(let y = 0; y < 24; y++) for(let x = 0; x < 24; x++) h += '<i style="--d:' + (((x*0.09 + y*0.06) % 2.6) - 2.6).toFixed(2) + 's"></i>';
  grid.innerHTML = h;
  let v = 0, manual = false, last = 0;
  const iv = setInterval(()=>{ if(manual) return; v += (30 - v) * 0.05 + 0.1; pct.textContent = Math.min(30, Math.round(v)) + "%"; }, 250);
  return {
    set(p, l){ manual = true; last = Math.max(last, p); pct.textContent = Math.round(last) + "%"; if(l) label.textContent = l; },
    stop(){ clearInterval(iv); },
    async finish(){ clearInterval(iv); label.textContent = "Creating image"; pct.textContent = "100%"; await sleep(reduced ? 0 : 400); }
  };
}

// ---------- prompt writing (the model only ever returns the prompt itself) ----------
const NEW_IMG_SYS = "You write prompts for a Stable Diffusion image model. Turn the user's request into ONE prompt of comma-separated descriptive phrases (max 45 words) covering subject, style, lighting and composition. Output only the prompt, nothing else.";
const EDIT_IMG_SYS = "You edit prompts for an image-to-image model. You receive the ORIGINAL prompt and a CHANGE requested by the user. Output the full updated prompt (max 50 words, comma-separated phrases) that keeps the original subject and details and clearly applies the change. If the change is a style change, replace the old style entirely. Output only the prompt, nothing else.";

async function llmPrompt(system, user, fallback){
  try{
    const res = await aiFetch("chat/completions", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer " + API_KEY },
      body:JSON.stringify({ model:MODEL_FAST, stream:false, temperature:0.5, max_tokens:1500, reasoning_effort:"low",
        messages:[{ role:"system", content:system }, { role:"user", content:user }] })
    });
    if(!res.ok) return fallback;
    const j = await res.json();
    const t = cleanPrompt((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "");
    if(t.length < 8 || /^edit the existing/i.test(t) || /^original\b/i.test(t)) return fallback;
    return t;
  }catch(e){ return fallback; }
}

// ---------- result card: image + Download / Regenerate, no caption ----------
function renderImage(bubble, d){
  const root = el("div", "guide img-out");
  const im = new Image(); im.alt = "Generated image"; im.src = d.url;
  root.appendChild(im);
  const foot = el("div", "lst-foot");
  const dl = txt("button", "lst-btn", "Download");
  dl.onclick = ()=>{ const a = document.createElement("a"); a.href = d.url; a.download = "aither-ai-image.jpg"; document.body.appendChild(a); a.click(); a.remove(); };
  const rg = txt("button", "lst-btn", "Regenerate");
  rg.onclick = async ()=>{
    if(bubble._regen) return;
    bubble._regen = true;
    const ui = genUI(bubble);
    try{
      const url = await hordeImage(cleanPrompt(d.prompt), ui); await ui.finish();
      const nd = { prompt:cleanPrompt(d.prompt), url:url };
      if(bubble._msg){ bubble._msg.content = FENCE + "image\n" + JSON.stringify(nd) + "\n" + FENCE; save(); }
      renderImage(bubble, nd);
    }catch(e){ ui.stop(); renderImage(bubble, d); toast(hordeMsg(e)); }
    finally{ bubble._regen = false; }
  };
  foot.append(dl, rg); root.appendChild(foot);
  bubble.innerHTML = ""; bubble.appendChild(root);
}

async function makeImage(chat, bubble, text, previousImage){
  const raw = text.replace(/^\/(image|imagine|img)\s*/i, "").trim() || text;
  const ui = genUI(bubble);
  try{
    let p;
    if(previousImage){
      const base = cleanPrompt(previousImage.prompt);
      p = await llmPrompt(EDIT_IMG_SYS, "ORIGINAL: " + base + "\nCHANGE: " + raw, base + ", " + raw);
    }else{
      p = await llmPrompt(NEW_IMG_SYS, raw, raw + ", high quality, detailed");
    }
    const data = { prompt:p, url:await hordeImage(p, ui, previousImage && previousImage.url) };
    await ui.finish();
    const content = FENCE + "image\n" + JSON.stringify(data) + "\n" + FENCE;
    chat.messages.push({ role:"assistant", content:content });
    bubble._msg = chat.messages[chat.messages.length - 1];
    paint(bubble, content, false);
    save(); recordUsage(text, "");
    if(chat.messages.filter(m=> m.role === "user").length === 1) summarizeChat(chat);
  }catch(e){
    ui.stop();
    bubble.closest(".msg")?.remove();
    showErr(hordeMsg(e));
    chat.messages.pop();
    if(current === chat){ input.value = text; autosize(); updateSend(); }
  }
}

function paint(bubble, text, streaming){
  const kind = blockKind(text);
  if(kind){
    if(streaming){
      const label = kind === "list" ? "Making your list\u2026" : kind === "guide" ? "Building your guide\u2026" : "Working on it\u2026";
      bubble.innerHTML = '<div class="gbuild"><span class="dots"><span></span><span></span><span></span></span><span class="tlabel">' + label + '</span></div>';
      return;
    }
    if(kind === "list"){ const d = parseList(text); if(d){ renderList(bubble, d); return; } }
    else if(kind === "image"){ const d = parseImage(text); if(d){ renderImage(bubble, d); return; } }
    else { const g = parseGuide(text); if(g){ renderGuide(bubble, g); return; } }
    text = text.replace(/^\s*```(guide|list|image)\s*/, "").replace(/```\s*$/, "");   // fallback: show as plain text
  }
  bubble.innerHTML = md(text);
  if(streaming){
    const c = document.createElement("span"); c.className = "caret";
    const last = bubble.lastElementChild;
    (last && /^(P|LI|H\d)$/.test(last.tagName) ? last : bubble).appendChild(c);
  }
}
// ---------- file attachments (images, PDFs, text and code files) ----------
// Vision models, tried in order. If Groq retires one (404), the next is used automatically. Check console.groq.com/docs/vision for the current list.
const VISION_MODELS = ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b"];
const ATT = { max:5, textChars:40000, textExt:/\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|jsx|ts|tsx|py|java|c|h|cpp|cs|go|rs|rb|php|sh|sql|yml|yaml|toml|ini|log|swift|kt|r|tex|ics|vcf|srt|vtt)$/i };
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
let attached = [];
const attRow = $("attachRow"), fileIn = $("fileIn");
function extOf(n){ const m = /\.([a-z0-9]+)$/i.exec(n); return m ? m[1].slice(0,4) : "file"; }
function fmtSize(n){ return n < 1024 ? n + " B" : n < 1048576 ? Math.round(n/1024) + " KB" : (n/1048576).toFixed(1) + " MB"; }
const IMG_EXT = /\.(jpe?g|jfif|png|gif|webp|avif|bmp|svg|ico|heic|heif|tiff?)$/i;
function decodeBlob(blob){
  return new Promise((res, rej)=>{
    const u = URL.createObjectURL(blob), im = new Image();
    im.onload = ()=> res({ im:im, u:u });
    im.onerror = ()=>{ URL.revokeObjectURL(u); rej(new Error("decode")); };
    im.src = u;
  });
}
function loadScript(src){
  return new Promise((res, rej)=>{
    const s = document.createElement("script"); s.src = src; s.onload = res;
    s.onerror = ()=> rej(new Error("Couldn't load the image converter. Check your connection."));
    document.head.appendChild(s);
  });
}
function toJpegData(src){   // src: an image or a canvas
  const w = src.naturalWidth || src.width || 1024, h = src.naturalHeight || src.height || 1024;
  const s = Math.min(1, 1280 / Math.max(w, h));
  const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
  const x = cv.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(src, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.82);
}
async function viaBlob(blob){ const d = await decodeBlob(blob); try{ return toJpegData(d.im); } finally{ URL.revokeObjectURL(d.u); } }
// Handles JPG, PNG, GIF, WebP, AVIF, BMP, SVG, ICO natively, plus HEIC/HEIF (iPhone) and TIFF through small converters
async function shrinkImage(file){
  const name = file.name || "", type = (file.type || "").toLowerCase();
  try{ return await viaBlob(file); }catch(e){}
  if(/heic|heif/.test(type) || /\.(heic|heif)$/i.test(name)){
    try{
      if(!window.heic2any) await loadScript("https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js");
      let out = await window.heic2any({ blob:file, toType:"image/jpeg", quality:0.85 });
      if(Array.isArray(out)) out = out[0];
      return await viaBlob(out);
    }catch(e){ throw new Error("Couldn't read " + name + ". Try exporting it as JPG."); }
  }
  if(/tiff/.test(type) || /\.tiff?$/i.test(name)){
    try{
      if(!window.UTIF) await loadScript("https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js");
      const buf = await file.arrayBuffer(), ifds = UTIF.decode(buf);
      UTIF.decodeImage(buf, ifds[0]);
      const cv = document.createElement("canvas"); cv.width = ifds[0].width; cv.height = ifds[0].height;
      cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(ifds[0])), cv.width, cv.height), 0, 0);
      return toJpegData(cv);
    }catch(e){ throw new Error("Couldn't read " + name + ". Try exporting it as JPG."); }
  }
  throw new Error(name + " isn't a supported image format.");
}
let pdfLib = null;
function loadPdf(){
  if(pdfLib) return pdfLib;
  pdfLib = new Promise((res, rej)=>{
    const s = document.createElement("script"); s.src = PDFJS + "pdf.min.js";
    s.onload = ()=>{ window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; res(window.pdfjsLib); };
    s.onerror = ()=>{ pdfLib = null; rej(new Error("Couldn't load the PDF reader. Check your connection.")); };
    document.head.appendChild(s);
  });
  return pdfLib;
}
async function readPdf(file){
  const lib = await loadPdf();
  const doc = await lib.getDocument({ data:await file.arrayBuffer() }).promise;
  let out = "";
  for(let i = 1; i <= Math.min(doc.numPages, 60) && out.length < ATT.textChars; i++){
    const c = await (await doc.getPage(i)).getTextContent();
    out += "\n" + c.items.map(x=> x.str).join(" ");
  }
  return out.trim();
}
function clip(text){ return text.length > ATT.textChars ? text.slice(0, ATT.textChars) + "\n[...file truncated...]" : text; }
// ---------- documents, spreadsheets, slides, email and audio ----------
const CDN = "https://cdn.jsdelivr.net/npm/";
const LIBS = { mammoth:[CDN + "mammoth@1.8.0/mammoth.browser.min.js", "mammoth"], xlsx:[CDN + "xlsx@0.18.5/dist/xlsx.full.min.js", "XLSX"], jszip:[CDN + "jszip@3.10.1/dist/jszip.min.js", "JSZip"] };
async function lib(k){ const l = LIBS[k]; if(!window[l[1]]) await loadScript(l[0]); return window[l[1]]; }
const AUDIO_EXT = /\.(wav|mp3|mpeg|mpga|ogg|oga|pcm|flac|aac|m4a|mp4|webm)$/i;
const WHISPER = "whisper-large-v3-turbo", WHISPER_OK = /\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm)$/i;

function htmlToText(s){ const d = new DOMParser().parseFromString(s, "text/html"); d.querySelectorAll("script,style").forEach(n=> n.remove()); return (d.body.textContent || "").replace(/\n{3,}/g, "\n\n"); }
function rtfToText(s){
  return s.replace(/\\par[d]?(?![a-z])/g, "\n").replace(/\\'([0-9a-f]{2})/gi, (m, h)=> String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (m, n)=> String.fromCharCode(n < 0 ? +n + 65536 : +n))
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info)(?:\{[^{}]*\}|[^{}])*\}/g, "").replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
function decodePart(body, enc){
  enc = (enc || "").toLowerCase();
  try{
    if(enc.indexOf("base64") >= 0) return new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s/g, "")), c=> c.charCodeAt(0)));
    if(enc.indexOf("quoted") >= 0){
      const b = body.replace(/=\r?\n/g, ""), bytes = [];
      for(let i = 0; i < b.length; i++){
        if(b[i] === "=" && /^[0-9a-f]{2}$/i.test(b.substr(i + 1, 2))){ bytes.push(parseInt(b.substr(i + 1, 2), 16)); i += 2; }
        else bytes.push(b.charCodeAt(i) & 255);
      }
      return new TextDecoder().decode(Uint8Array.from(bytes));
    }
  }catch(e){}
  return body;
}
function decodeWords(s){
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (m, cs, e, tx)=>{
    try{ return /b/i.test(e) ? new TextDecoder(cs).decode(Uint8Array.from(atob(tx), c=> c.charCodeAt(0))) : decodePart(tx.replace(/_/g, " "), "quoted-printable"); }catch(x){ return m; }
  });
}
function splitMime(raw){
  const i = raw.search(/\r?\n\r?\n/), head = i < 0 ? raw : raw.slice(0, i), body = i < 0 ? "" : raw.slice(i).replace(/^\r?\n\r?\n/, ""), h = {};
  head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach(l=>{ const m = /^([^:]+):\s*(.*)$/.exec(l); if(m && !(m[1].toLowerCase() in h)) h[m[1].toLowerCase()] = m[2]; });
  return { h:h, body:body };
}
function emlToText(raw){
  function walk(h, body){
    const ct = h["content-type"] || "text/plain", bm = /boundary="?([^";]+)"?/i.exec(ct);
    if(/multipart/i.test(ct) && bm){
      const r = { plain:"", html:"", atts:[] };
      body.split("--" + bm[1]).slice(1).filter(p=> !/^--/.test(p.trim())).forEach(p=>{
        const s = splitMime(p.replace(/^\r?\n/, "")), x = walk(s.h, s.body);
        r.plain += x.plain; r.html += x.html; r.atts = r.atts.concat(x.atts);
      });
      return r;
    }
    const dispo = h["content-disposition"] || "", nm = /name="?([^";]+)"?/i.exec(dispo + ";" + ct);
    if(/attachment/i.test(dispo)) return { plain:"", html:"", atts:[nm ? nm[1] : "attachment"] };
    const tx = decodePart(body, h["content-transfer-encoding"]);
    if(/text\/html/i.test(ct)) return { plain:"", html:htmlToText(tx), atts:[] };
    if(/text\/plain/i.test(ct)) return { plain:tx, html:"", atts:[] };
    return { plain:"", html:"", atts:nm ? [nm[1]] : [] };
  }
  const m = splitMime(raw), r = walk(m.h, m.body);
  const head = ["From", "To", "Cc", "Subject", "Date"].filter(k=> m.h[k.toLowerCase()]).map(k=> k + ": " + decodeWords(m.h[k.toLowerCase()])).join("\n");
  return head + "\n\n" + (r.plain.trim() || r.html.trim()) + (r.atts.length ? "\n\n[Attachments: " + r.atts.join(", ") + "]" : "");
}
async function readDocx(f){ const m = await lib("mammoth"); return (await m.extractRawText({ arrayBuffer:await f.arrayBuffer() })).value; }
async function readSheet(f){
  const X = await lib("xlsx"), wb = X.read(await f.arrayBuffer(), { type:"array" });
  return wb.SheetNames.map(n=> "## Sheet: " + n + "\n" + X.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n").trim();
}
async function readPptx(f){
  const Z = await lib("jszip"), z = await Z.loadAsync(await f.arrayBuffer());
  const names = Object.keys(z.files).filter(n=> /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b)=> parseInt(a.match(/\d+/g).pop()) - parseInt(b.match(/\d+/g).pop()));
  const out = [];
  for(let i = 0; i < names.length; i++){
    const d = new DOMParser().parseFromString(await z.files[names[i]].async("string"), "text/xml");
    const ps = Array.from(d.getElementsByTagName("a:p")).map(p=> Array.from(p.getElementsByTagName("a:t")).map(x=> x.textContent).join("")).filter(Boolean);
    out.push("## Slide " + (i + 1) + "\n" + ps.join("\n"));
  }
  return out.join("\n\n");
}
async function readOdf(f){
  const Z = await lib("jszip"), z = await Z.loadAsync(await f.arrayBuffer()), c = z.file("content.xml");
  if(!c) throw new Error("Couldn't read " + f.name + ".");
  const d = new DOMParser().parseFromString(await c.async("string"), "text/xml");
  return Array.from(d.getElementsByTagName("*")).filter(e=> e.nodeName === "text:p" || e.nodeName === "text:h").map(e=> e.textContent).join("\n");
}

// audio: sent to Groq Whisper; formats Whisper can't take are converted to 16 kHz mono WAV in the browser first
async function whisper(blob, name){
  const fd = new FormData(); fd.append("file", blob, name); fd.append("model", WHISPER); fd.append("response_format", "json");
  const r = await groqFetch("audio/transcriptions", { method:"POST", headers:{ "Authorization":"Bearer " + API_KEY }, body:fd });
  if(!r.ok){ let m = "Transcription failed (" + r.status + ")."; try{ const j = await r.json(); if(j.error && j.error.message) m = j.error.message; }catch(e){} throw new Error(m); }
  return (((await r.json()).text) || "").trim();
}
function wavBlob(s, rate){
  const n = s.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, str)=>{ for(let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for(let i = 0; i < n; i++){ const x = Math.max(-1, Math.min(1, s[i])); v.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true); }
  return new Blob([b], { type:"audio/wav" });
}
async function decode16k(f){
  const AC = window.AudioContext || window.webkitAudioContext, OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ac = new AC(); let buf;
  try{ buf = await ac.decodeAudioData(await f.arrayBuffer()); } finally{ try{ ac.close(); }catch(e){} }
  const off = new OC(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000), src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}
async function transcribe(f){
  const name = f.name || "audio", sendName = name.replace(/\.oga$/i, ".ogg"), raw = /\.pcm$/i.test(name);
  if(!raw && WHISPER_OK.test(sendName) && f.size <= 24 * 1048576){
    try{ return await whisper(f, sendName); }catch(e){ if(/401|api key|invalid/i.test(e.message)) throw e; }
  }
  let s;
  if(raw){ const ab = await f.arrayBuffer(); s = Float32Array.from(new Int16Array(ab, 0, Math.floor(ab.byteLength / 2)), x=> x / 32768); }   // raw PCM is assumed 16-bit, 16 kHz, mono
  else{ try{ s = await decode16k(f); }catch(e){ throw new Error("Couldn't decode " + name + " in this browser."); } }
  const seg = 16000 * 600, out = [];
  for(let i = 0; i < s.length; i += seg) out.push(await whisper(wavBlob(s.subarray(i, i + seg), 16000), "part.wav"));
  return out.join(" ").trim();
}

let reading = 0;
async function addFiles(list){
  for(const f of Array.from(list)){
    if(attached.length >= ATT.max){ toast("You can attach up to " + ATT.max + " files per message."); break; }
    const name = f.name || "file", e = ((/\.([a-z0-9]+)$/i.exec(name) || [])[1] || "").toLowerCase(), type = f.type || "";
    const big = mb=>{ if(f.size > mb * 1048576) throw new Error(name + " is too large (" + mb + " MB max)."); };
    const addText = tx=>{ tx = String(tx || "").replace(/\u0000/g, ""); if(!tx.trim()) throw new Error("No readable text in " + name + "."); attached.push({ name:name, kind:"text", size:f.size, text:clip(tx) }); };
    reading++; updateSend();
    try{
      if(/^image\//.test(type) || IMG_EXT.test(name)){
        big(25); attached.push({ name:name, kind:"image", size:f.size, dataUrl:await shrinkImage(f) });
      }else if(AUDIO_EXT.test(name) || /^audio\//.test(type)){
        big(50); toast("Transcribing " + name + "\u2026");
        const tx = await transcribe(f); if(!tx) throw new Error("No speech found in " + name + ".");
        addText("[Audio transcript of " + name + "]\n" + tx);
      }else if(e === "pdf" || type === "application/pdf"){ big(25); addText(await readPdf(f)); }
      else if(e === "docx"){ big(25); addText(await readDocx(f)); }
      else if(e === "pptx"){ big(50); addText(await readPptx(f)); }
      else if(e === "odt" || e === "odp"){ big(25); addText(await readOdf(f)); }
      else if(e === "xlsx" || e === "xls" || e === "ods"){ big(25); addText(await readSheet(f)); }
      else if(e === "rtf"){ big(10); addText(rtfToText(await f.text())); }
      else if(e === "eml"){ big(25); addText(emlToText(await f.text())); }
      else if(/^text\//.test(type) || type === "application/json" || ATT.textExt.test(name)){
        big(5); const tx = await f.text();
        if(tx.indexOf("\u0000") >= 0) throw new Error(name + " isn't a text file.");
        addText(tx);
      }else throw new Error("\u201c" + name + "\u201d isn't supported. Old .doc and .ppt files should be saved as .docx or .pptx first.");
    }catch(err){ toast(err.message || ("Couldn't read " + name + ".")); }
    finally{ reading--; }
    renderAttach();
  }
  updateSend();
}
function renderAttach(){
  attRow.innerHTML = "";
  attached.forEach((a, i)=>{
    const c = el("div", "att");
    if(a.kind === "image"){ const im = new Image(); im.src = a.dataUrl; im.alt = ""; c.appendChild(im); }
    else c.appendChild(txt("div", "ai", extOf(a.name)));
    const n = el("div", "an"); n.append(txt("b", "", a.name), txt("small", "", fmtSize(a.size))); c.appendChild(n);
    const x = el("button", "", '<svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M6 6l12 12M18 6L6 18"/></svg>');
    x.setAttribute("aria-label", "Remove " + a.name);
    x.onclick = ()=>{ attached.splice(i, 1); renderAttach(); updateSend(); };
    c.appendChild(x); attRow.appendChild(c);
  });
}
function attList(files){
  const box = el("div", "msg-att");
  files.forEach(f=>{
    if(f.kind === "image"){ const im = new Image(); im.className = "big"; im.alt = f.name; im.src = f.dataUrl; box.appendChild(im); }
    else{ const c = el("div", "att"); c.appendChild(txt("div", "ai", extOf(f.name))); const n = el("div", "an"); n.append(txt("b", "", f.name), txt("small", "", fmtSize(f.size))); c.appendChild(n); box.appendChild(c); }
  });
  return box;
}
// What the model receives for a message that has files
function apiContent(m, imgSet){
  if(!m.files || !m.files.length) return m.content;
  let tx = m.content || "";
  const imgs = [];
  m.files.forEach(f=>{
    if(f.kind === "image"){ if(imgSet.has(f)) imgs.push(f); else tx += "\n\n[Image attached earlier: " + f.name + "]"; }
    else tx += "\n\n[Attached file: " + f.name + "]\n" + f.text;
  });
  if(!imgs.length) return tx;
  return [{ type:"text", text:tx || "Describe this image." }].concat(imgs.map(f=> ({ type:"image_url", image_url:{ url:f.dataUrl } })));
}

// ---------- computers inside an embedded web view (like Shortcuts) can't use uploads or the mic ----------
const IS_COMPUTER = /Macintosh|Windows|Linux|CrOS/i.test(navigator.userAgent) && navigator.maxTouchPoints <= 1;
const IN_WEBVIEW = !/Safari|Chrome|CriOS|Firefox|FxiOS|Edg/i.test(navigator.userAgent);
const COMPUTER_VIEW = IS_COMPUTER && IN_WEBVIEW;

$("plus").onclick = ()=>{
  if(COMPUTER_VIEW){
    toast("File uploads aren't available in this view on computers. Open Aither AI in Safari or Chrome, or use your phone.");
    return;
  }
  fileIn.click();
};
fileIn.onchange = ()=>{ addFiles(fileIn.files).then(()=>{ fileIn.value = ""; }); };
input.addEventListener("paste", e=>{
  const fs = Array.from((e.clipboardData && e.clipboardData.files) || []);
  if(fs.length){ e.preventDefault(); addFiles(fs); }
});
const hasFiles = e=> e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf("Files") >= 0;
["dragenter","dragover"].forEach(ev=> document.addEventListener(ev, e=>{ if(hasFiles(e)){ e.preventDefault(); stage.classList.add("drag"); } }));
document.addEventListener("dragleave", e=>{ if(!e.relatedTarget) stage.classList.remove("drag"); });
document.addEventListener("drop", e=>{ if(!hasFiles(e)) return; e.preventDefault(); stage.classList.remove("drag"); addFiles(e.dataTransfer.files); });

function addMsg(role, text, animate, files){
  const row = document.createElement("div");
  row.className = "msg " + (role==="user"?"user":"ai") + (animate ? " anim" : "");
  const b = document.createElement("div"); b.className = "bubble";
  if(role==="user") b.textContent = text;
  else if(text) paint(b, text, false);
  else b.innerHTML = '<span class="dots"><span></span><span></span><span></span></span>';
  if(files && files.length) row.appendChild(attList(files));
  if(!(role === "user" && !text)) row.appendChild(b);
  msgsEl.appendChild(row);
  msgsEl.scrollTop = msgsEl.scrollHeight;
  return b;
}
function renderChat(){
  msgsEl.innerHTML = "";
  current.messages.forEach(m => { const b = addMsg(m.role, m.content, false, m.files); b._msg = m; });
  setEmpty(current.messages.length===0);
  if(current.messages.length===0) setWelcomeMessage();
  renderRecents();
}
function renderRecents(){
  const box = $("recents"); box.innerHTML = "";
  let n = 0;
  chats.slice().reverse().filter(c=>!c.archived).forEach(c=>{
    const row = document.createElement("div");
    row.className = "chat-item" + (c.id===current.id?" active":"");
    if(!seenChats.has(c.id)){ row.classList.add("enter"); row.style.animationDelay = Math.min(n,8)*0.04 + "s"; seenChats.add(c.id); }
    n++;
    const t = document.createElement("button"); t.className="t"; t.textContent=c.title;
    t.onclick = ()=>{ current=c; renderChat(); closeOnMobile(); };
    const d = document.createElement("button"); d.className="del"; d.innerHTML='<svg viewBox="0 0 24 24" style="width:16px;height:16px"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    d.onclick = e=>{
      e.stopPropagation();
      row.classList.add("leaving");
      setTimeout(()=>{
        chats = chats.filter(x=>x.id!==c.id); save();
        if(current.id===c.id){ current=newChatObj(); }
        renderChat();
      }, reduced ? 0 : 280);
    };
    const a = document.createElement("button"); a.className="del arc"; a.title="Archive"; a.setAttribute("aria-label","Archive chat");
    a.innerHTML='<svg viewBox="0 0 24 24" style="width:16px;height:16px"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9M10 13h4"/></svg>';
    a.onclick = e=>{
      e.stopPropagation();
      row.classList.add("leaving");
      setTimeout(()=>{
        c.archived = true; save();
        if(current.id===c.id){ current=newChatObj(); }
        renderChat(); toast("Chat archived");
      }, reduced ? 0 : 280);
    };
    row.append(t,a,d); box.appendChild(row);
  });
}
function closeOnMobile(){ if(window.innerWidth<=760) app.classList.add("collapsed"); }
function showErr(m){
  errEl.textContent = m;
  errEl.classList.remove("show");
  if(m){ void errEl.offsetWidth; errEl.classList.add("show"); }
}

// ---------- chat titles: AI writes a short summary of the conversation ----------
async function summarizeChat(chat){
  const convo = chat.messages.slice(0, 8).map(m=>{
    let c = m.content || "";
    if(m.role === "assistant" && isGuideText(c)){ const g = parseGuide(c); c = "[Card: " + ((g && g.title) || "") + "]"; }
    return (m.role === "user" ? "User: " : "Assistant: ") + c.slice(0, 400);
  }).join("\n");
  try{
    const res = await aiFetch("chat/completions", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer " + API_KEY },
      body:JSON.stringify({
        model: MODEL_FAST, stream:false, temperature:0.3, max_tokens:300,
        messages:[
          { role:"system", content:"Write a short title (3 to 6 words, no quotes, no emoji, no trailing punctuation) that summarizes what this whole conversation is about. Reply with only the title." },
          { role:"user", content:convo }
        ]
      })
    });
    if(!res.ok) return;
    const j = await res.json();
    let t = ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").split("\n")[0];
    t = t.replace(/^["'\u201c\u201d\s]+|["'\u201c\u201d.\s]+$/g, "").slice(0, 50);
    if(t && chats.includes(chat)){ chat.title = t; save(); renderRecents(); }
  }catch(e){}
}

// ---------- sending ----------
async function send(){
  const text = input.value.trim();
  if(reading){ toast("Still reading your files. One moment."); return; }
  if((!text && !attached.length) || busy) return;
  if(!user){ showErr("Please sign in with your Aither Account to chat with Aither AI."); openLogin(); return; }
  showErr("");
  stopSpeaking();

  const chat = current;
  if(!chats.includes(chat)) chats.push(chat);
  const sentFiles = attached.slice(); attached = []; renderAttach();
  chat.messages.push({role:"user", content:text, files:sentFiles.length ? sentFiles : undefined});
  if(chat.title==="New chat") chat.title = (text || (sentFiles[0] && sentFiles[0].name) || "New chat").slice(0,40);
  const reqWin = chat.messages.slice(-20);
  const imgSet = new Set([].concat.apply([], reqWin.map(m=> (m.files || []).filter(f=> f.kind === "image"))).slice(-3));   // Groq vision allows 3 images per request
  const requestMessages = reqWin
  .filter(m=> !(m.role === "assistant" && (m.content.indexOf(FENCE + "image") === 0 || /^\[generated an image\]$/i.test(m.content.trim()))))
  .map(m=> ({ role:m.role, content:apiContent(m, imgSet) }));

  input.value=""; autosize(); updateSend();
  setEmpty(false);
  addMsg("user", text, true, sentFiles);
  const bubble = addMsg("ai","",true);
  if(thinkOn) bubble.insertAdjacentHTML("beforeend", '<span class="tlabel">Thinking\u2026</span>');
  renderRecents();
  busy = true; sendBtn.disabled = true; sendBtn.classList.add("busy");

  const forced = !!chat._awaitingImage;
  chat._awaitingImage = false;
  const previousImage = latestImageMessage(chat);
  const correctionMode = !!previousImage && isImageEdit(text);
  const imgMode = !sentFiles.length && ((forced && !/^(no|nope|never ?mind|cancel|stop)\b/i.test(text)) || isImageRequest(text) || correctionMode);
  if(imgMode){
    if(!forced && !correctionMode && !imageSubject(text)){
      const ask = "Happy to! What should the image show? Describe the subject and style, for example: a fox in a snowy forest, watercolor.";
      chat.messages.push({ role:"assistant", content:ask });
      bubble._msg = chat.messages[chat.messages.length - 1];
      chat._awaitingImage = true;
      paint(bubble, ask, false); save();
    }else{
      await makeImage(chat, bubble, text, correctionMode ? previousImage : null);
    }
    busy = false; sendBtn.disabled = false; sendBtn.classList.remove("busy"); updateSend();
    return;
  }

  let full = "", shown = 0, raf = 0, lastPaint = 0, streamDone = false;
  let drainedResolve; const drained = new Promise(r=> drainedResolve = r);
  const nearBottom = ()=> msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 140;
  // Reveals text a little each frame so bursty network chunks look like steady typing
  let guideShown = false;
  function tick(t){
    if(isGuideText(full)){
      shown = full.length;
      if(!guideShown){ paint(bubble, full, true); guideShown = true; }
    }
    const backlog = full.length - shown;
    if(backlog > 0){
      shown = Math.min(full.length, shown + Math.max(1, Math.ceil(backlog / 14)));
      if(t - lastPaint > 45){
        const stick = nearBottom();
        paint(bubble, full.slice(0, shown), true);
        if(stick) msgsEl.scrollTop = msgsEl.scrollHeight;
        lastPaint = t;
      }
    }
    if(streamDone && shown >= full.length){ drainedResolve(); return; }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  try{
    const models = imgSet.size ? VISION_MODELS : [thinkOn ? MODEL_THINK : MODEL_FAST];
    let res;
    for(const model of models){
      res = await aiFetch("chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+API_KEY},
        body:JSON.stringify({ model:model, stream:true, messages:[{role:"system",content:buildSystem()}].concat(requestMessages) })
      });
      if(res.status !== 404 && res.status !== 400 || res.ok) break;   // model missing: try the next one
    }
    if(!res.ok){
      let msg = "Error "+res.status;
      try{ const j = await res.json(); msg += ": "+(j.error&&j.error.message||""); }catch(e){}
      throw new Error(msg);
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    while(true){
      const {done,value} = await reader.read();
      if(done) break;
      buf += dec.decode(value,{stream:true});
      const lines = buf.split("\n"); buf = lines.pop();
      for(const ln of lines){
        const s = ln.trim();
        if(!s.startsWith("data:")) continue;
        const data = s.slice(5).trim();
        if(data==="[DONE]") continue;
        try{
          const delta = JSON.parse(data).choices[0].delta.content;
          if(delta){ full += delta; }
        }catch(e){}
      }
    }
    streamDone = true; await drained; cancelAnimationFrame(raf);
    full = full.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
    if(full) paint(bubble, full, false); else bubble.textContent = "(no response)";
    if(nearBottom()) msgsEl.scrollTop = msgsEl.scrollHeight;
    chat.messages.push({role:"assistant", content:full||"(no response)"});
    bubble._msg = chat.messages[chat.messages.length - 1];
    save();
    const asked = chat.messages.filter(m=> m.role === "user").length;
    if(asked === 1 || asked === 3) summarizeChat(chat);   // title after the 1st question, refreshed after the 3rd
    learnFrom(text);                                      // Aither AI memory: save lasting facts the user shared
    recordUsage(text, full);
    speakReply(bubble);
  }catch(e){
    cancelAnimationFrame(raf);
    bubble.closest(".msg")?.remove();
    showErr(e.message||"Something went wrong.");
    chat.messages.pop();
    attached = sentFiles.concat(attached); renderAttach();
    if(current === chat){ input.value = text; autosize(); updateSend(); }
  }
  busy = false; sendBtn.disabled = false; sendBtn.classList.remove("busy");
  updateSend();
}

// ---------- UI wiring ----------
function autosize(){ input.style.height="auto"; input.style.height=Math.min(input.scrollHeight,160)+"px"; }
function updateSend(){ sendBtn.classList.toggle("ready", (input.value.trim().length>0 || attached.length>0) && !busy && !reading); }
input.addEventListener("input",()=>{ autosize(); updateSend(); });
input.addEventListener("keydown",e=>{
  if(e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  if(prefs.sendMode === "mod"){ if(e.metaKey || e.ctrlKey){ e.preventDefault(); send(); } }   // plain Enter = new line
  else if(window.innerWidth>760){ e.preventDefault(); send(); }
});
sendBtn.onclick = send;

$("toggle").onclick = ()=> app.classList.toggle("collapsed");
$("backdrop").onclick = ()=> app.classList.add("collapsed");
function fresh(){
  attached = []; renderAttach();
  if(current && current.messages.length && !chats.includes(current)){ chats.push(current); save(); }
  current = newChatObj();
  renderChat();
  showErr("");
  input.value = "";
  autosize();
  updateSend();
  input.focus();
  closeOnMobile();
}
$("newChat").onclick = fresh;
$("think").onclick = ()=>{ thinkOn=!thinkOn; $("think").classList.toggle("on",thinkOn); };
document.querySelectorAll(".sug").forEach(b=> b.onclick = ()=>{ input.value=b.dataset.p; autosize(); updateSend(); input.focus(); });

// Dictation (needs Web Speech API, HTTPS, and mic permission)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
const micBtn = $("mic");

function stopDictation(){
  micBtn.classList.remove("rec");
  micBtn.setAttribute("aria-label", "Start dictation");
  micBtn.title = "Start dictation";
  rec = null;
}

micBtn.onclick = ()=>{
  if(rec){ rec.stop(); return; }
  if(COMPUTER_VIEW){
    showErr("Voice dictation isn't available in this view on computers. Open Aither AI in Safari or Chrome, or use your phone.");
    return;
  }
  if(!SR){
    showErr("This browser does not support built-in voice dictation. Try Chrome on HTTPS, or use your device's keyboard microphone.");
    return;
  }
  if(!window.isSecureContext){
    showErr("Voice dictation requires a secure page (HTTPS or localhost).");
    return;
  }
  showErr("");
  const recognition = new SR();
  rec = recognition;
  recognition.lang = (prefs.dictLang && prefs.dictLang !== "auto") ? prefs.dictLang : (navigator.language || "en-US");
  recognition.interimResults = true;
  recognition.continuous = false;

  const base = input.value.trim();
  let finalTranscript = "";

  recognition.onresult = e=>{
    let interim = "";
    for(let i=e.resultIndex; i<e.results.length; i++){
      const part = e.results[i][0].transcript;
      if(e.results[i].isFinal) finalTranscript += part; else interim += part;
    }
    input.value = [base, (finalTranscript + interim).trim()].filter(Boolean).join(" ");
    autosize(); updateSend();
  };
  recognition.onerror = e=>{
    const messages = {
      "not-allowed": "Microphone access was blocked. Allow microphone permission for this site and try again.",
      "service-not-allowed": "The browser's speech-recognition service is unavailable.",
      "no-speech": "No speech was detected. Try again and speak after dictation starts.",
      "audio-capture": "No microphone was detected. Check your microphone connection."
    };
    showErr(messages[e.error] || ("Voice dictation error: " + e.error));
    stopDictation();
  };
  recognition.onend = stopDictation;
  micBtn.classList.add("rec");
  micBtn.setAttribute("aria-label", "Stop dictation");
  micBtn.title = "Stop dictation";

  try{ recognition.start(); }
  catch(e){ stopDictation(); showErr("Could not start voice dictation. Try again or check microphone permissions."); }
};

// start
if(window.innerWidth>760) app.classList.remove("collapsed");
current = newChatObj();
renderChat();
updateSend();

// ============================
// AITHER SIGN IN + CENTRAL SUPABASE
// ============================
const SUPABASE_URL = window.AitherConfig.supabaseUrl;
const SUPABASE_KEY = window.AitherConfig.supabasePublishableKey;
const AITHER_SIGNIN_URL = window.AitherConfig.signInUrl;
const AITHER_HANDOFF_URL = SUPABASE_URL + "/functions/v1/aither-auth-handoff";
const loginOverlay = $("loginOverlay"), logoutOverlay = $("logoutOverlay"), sideFoot = $("sideFoot");

// Storage that still works if the web view blocks localStorage.
const memStore = {};
const safeStorage = {
  getItem:k=>{ try{ return localStorage.getItem(k); }catch(e){ return memStore[k]===undefined?null:memStore[k]; } },
  setItem:(k,v)=>{ try{ localStorage.setItem(k,v); }catch(e){ memStore[k]=v; } },
  removeItem:k=>{ try{ localStorage.removeItem(k); }catch(e){ delete memStore[k]; } }
};

// Load saved provider preferences only after safeStorage has been initialized.
aiProviderSettings = readAIProviderSettings();

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth:{ storage:safeStorage, persistSession:true, autoRefreshToken:true, detectSessionInUrl:false }
});
let user = null;
function initials(name){
  return name.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase() || "?";
}
function toast(msg){
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(()=>t.classList.remove("show"), 3200);
}
function needSetup(){ toast("Continue with Aither Sign In to use your Aither Account."); }
function openLogin(){ loginOverlay.classList.add("show"); closeOnMobile(); }
function closeLogin(){ loginOverlay.classList.remove("show"); }
function startAitherSignIn(){
  const url = new URL(AITHER_SIGNIN_URL);
  url.searchParams.set("app", "AitherAI");
  url.searchParams.set("return_url", location.href);
  location.assign(url.href);
}
$("loginClose").onclick = closeLogin;
$("aitherSignInBtn").onclick = startAitherSignIn;
loginOverlay.addEventListener("click", e=>{ if(e.target === loginOverlay) closeLogin(); });

async function redeemAitherSignInCode(){
  const params = new URLSearchParams(location.search);
  const code = params.get("aither_supabase_code");
  if(!code) return null;
  const response = await fetch(AITHER_HANDOFF_URL, {
    method:"POST",
    headers:{ "Content-Type":"application/json", apikey:SUPABASE_KEY },
    body:JSON.stringify({ action:"redeem", code, return_origin:location.origin }),
    cache:"no-store"
  });
  const result = await response.json().catch(()=>({}));
  if(!response.ok || !result.access_token || !result.refresh_token){
    throw new Error(result.error === "invalid_or_expired_code" ? "Your sign-in link expired. Please try signing in again." : (result.error || "Could not complete Aither Sign In."));
  }
  const { data, error } = await sb.auth.setSession({ access_token:result.access_token, refresh_token:result.refresh_token });
  if(error) throw error;
  params.delete("aither_supabase_code");
  history.replaceState({}, document.title, location.pathname + (params.size ? "?" + params.toString() : "") + location.hash);
  return data.session;
}

function loadLocalChatsForUser(uid){
  localChatOwner = uid;
  try{
    let saved = localStorage.getItem("aither_ai_chats_" + uid);
    // One-time import of the original guest cache into the first Aither account used on this device.
    if(saved === null){
      const guest = localStorage.getItem("astra_chats");
      if(guest !== null){
        saved = guest;
        localStorage.setItem("aither_ai_chats_" + uid, guest);
        localStorage.removeItem("astra_chats");
      }
    }
    chats = JSON.parse(saved || "[]");
    if(!Array.isArray(chats)) chats = [];
  }catch(e){ chats = []; }
}

function setUserFromSession(session){
  const u = session && session.user;
  const nextId = u ? u.id : null;
  const previousId = user ? user.id : null;
  if(previousId && previousId !== nextId){
    try{ localStorage.setItem("aither_ai_chats_" + previousId, JSON.stringify(chats)); }catch(e){}
    resetCloud();
    chats = []; current = newChatObj(); renderChat();
    localChatOwner = null;
  }
  if(nextId && nextId !== previousId){
    loadLocalChatsForUser(nextId);
    current = newChatObj();
    renderChat();
  }
  if(!u){ user = null; }
  else{
    const meta = u.user_metadata || {};
    const email = u.email || u.phone || "";
    user = { id:u.id, email:email, name: meta.display_name || meta.full_name || meta.name || meta.username || email.split("@")[0] || "Account" };
  }
  applyUserPrefs(u || null);
  if(user && cloud.uid !== user.id){
    cloud.uid = user.id; cloud.ready = false; cloud.ids = new Set(); cloud.snap = new Map(); pullChats();
  }
  renderSideFoot();
}

sb.auth.onAuthStateChange((_event, session)=> setUserFromSession(session));
(async function bootAitherAuth(){
  try{
    await redeemAitherSignInCode();
    const { data, error } = await sb.auth.getSession();
    if(error) throw error;
    setUserFromSession(data.session);
  }catch(error){
    console.error("Aither Sign In:", error);
    toast(error.message || "Aither Sign In could not be completed.");
    setUserFromSession(null);
  }
})();

function renderSideFoot(){
  if(!user){
    sideFoot.innerHTML =
      '<div class="promo"><h3>Get responses tailored to you</h3>' +
      '<p>Sign in with your Aither Account to sync chats, settings, and memories across your devices.</p>' +
      '<button class="pill" id="sideLogin">Continue with Aither Sign In</button></div>';
    $("sideLogin").onclick = openLogin;
  }else{
    sideFoot.innerHTML =
      '<button class="userrow" id="sideUser"><div class="av"></div><div><div class="nm"></div><div class="em"></div></div></button>';
    sideFoot.querySelector(".av").textContent = initials(user.name);
    sideFoot.querySelector(".nm").textContent = user.name;
    sideFoot.querySelector(".em").textContent = user.email;
    $("sideUser").onclick = toggleUserMenu;
  }
  renderTopAccountMenu();
}

// Logout
function openLogout(){
  if(!user) return;
  $("lgAv").textContent = initials(user.name);
  $("lgName").textContent = user.name;
  $("lgEmail").textContent = user.email;
  logoutOverlay.classList.add("show");
}
function closeLogout(){ logoutOverlay.classList.remove("show"); }
$("lgCancel").onclick = closeLogout;
$("lgGo").onclick = async ()=>{
  await withBusy($("lgGo"), "Logging out...", async ()=>{
    if(sb){ const { error } = await sb.auth.signOut(); if(error){ toast(error.message); return; } }
    else { user = null; renderSideFoot(); }
    closeLogout(); toast("Logged out");
  });
};

document.addEventListener("keydown", e=>{
  if(e.key !== "Escape") return;
  if(logoutOverlay.classList.contains("show")) closeLogout();
  else if(loginOverlay.classList.contains("show")) closeLogin();
});

renderSideFoot();

// ============================
// SETTINGS
// General, Appearance, Account, Archived chats, Voice, Storage, Personalization, Keyboard, Usage.
// Preferences are saved on this device and synced to the signed-in Supabase account
// (stored in the account's user metadata, so no database table is needed).
// ============================
const PREF_DEFAULTS = { memoryOn:true, style:"default", warmth:"default", enthusiasm:"default", emoji:"default",
  visual:"default", headers:"default", nickname:"", occupation:"", about:"", instructions:"",
  suggestions:true, voice:true, memories:[],
  theme:"system", textSize:"default", reduceMotion:false, sendMode:"enter", replyLang:"auto",
  shortcuts:true, dictLang:"auto", readAloud:false, voiceName:"", _ts:0 };
const PREF_LIMITS = { memories:20, memoryLen:120, instructions:600, about:300, occupation:60, nickname:40 };
const PREF_ENUMS = {
  style:["default","professional","friendly","candid","quirky","efficient","nerdy","cynical"],
  warmth:["less","default","more"], enthusiasm:["less","default","more"], emoji:["less","default","more"],
  visual:["less","default","more"], headers:["less","default","more"],
  theme:["system","light","dark"], textSize:["small","default","large","xlarge"], sendMode:["enter","mod"],
  replyLang:["auto","English","Spanish","French","German","Portuguese","Italian","Chinese","Japanese","Korean","Hindi","Russian","Arabic"],
  dictLang:["auto","en-US","en-GB","es-ES","fr-FR","de-DE","it-IT","pt-BR","zh-CN","ja-JP","ko-KR","hi-IN","ru-RU","ar-SA"]
};
function cleanPrefs(raw){
  const p = Object.assign({}, PREF_DEFAULTS, { memories:[] });
  if(!raw || typeof raw !== "object") return p;
  Object.keys(PREF_ENUMS).forEach(k=>{ if(PREF_ENUMS[k].indexOf(raw[k]) >= 0) p[k] = raw[k]; });
  p.memoryOn = raw.memoryOn !== false;
  p.suggestions = raw.suggestions !== false;
  p.voice = raw.voice !== false;
  p.shortcuts = raw.shortcuts !== false;
  p.reduceMotion = raw.reduceMotion === true;
  p.readAloud = raw.readAloud === true;
  p.voiceName = String(raw.voiceName || "").slice(0, 80);
  ["nickname","occupation","about","instructions"].forEach(k=>{ p[k] = String(raw[k] || "").slice(0, PREF_LIMITS[k]); });
  p.memories = Array.isArray(raw.memories)
    ? raw.memories.map(m=> String(m || "").trim().slice(0, PREF_LIMITS.memoryLen)).filter(Boolean).slice(-PREF_LIMITS.memories)
    : [];
  p._ts = Number(raw._ts) || 0;
  return p;
}

let prefs = cleanPrefs(null);
let prefsUserId = null;
let syncTimer = null, savedTimer = null;

const uMenu = $("uMenu"), stOverlay = $("stOverlay"), stMain = $("stMain");
let curSec = "general";

// ---------- build the system prompt from the user's settings ----------
const TONE = {
  professional:"Tone: polished, precise and businesslike. Avoid slang.",
  friendly:"Tone: warm, upbeat and conversational, like a supportive friend.",
  candid:"Tone: direct and honest. Give straight opinions and gentle pushback when warranted, without being harsh.",
  quirky:"Tone: playful and imaginative, with light humor and fun turns of phrase.",
  efficient:"Tone: extremely concise and plain. No filler or pleasantries; go straight to the answer.",
  nerdy:"Tone: curious and enthusiastic about details. Explain the why behind things and enjoy brief geeky tangents.",
  cynical:"Tone: dry, wry and a little sarcastic, but always genuinely helpful and never mean."
};
function level(v, less, more){ return v === "less" ? less : v === "more" ? more : ""; }

function buildSystem(){
  const p = prefs, lines = [];
  if(TONE[p.style]) lines.push(TONE[p.style]);
  lines.push(level(p.warmth, "Be less warm and more matter-of-fact.", "Be extra warm, empathetic and encouraging."));
  lines.push(level(p.enthusiasm, "Keep your energy calm and understated; avoid exclamation marks.", "Be energetic and enthusiastic."));
  lines.push(level(p.emoji, "Avoid emojis (the single title emoji on guide cards is the only exception).", "Use emojis generously; this overrides the earlier limit on emojis."));
  lines.push(level(p.headers, "Prefer flowing prose. Avoid headings and bullet lists unless the user asks for them or the content truly needs them.", "Structure answers with clear ## headings and bullet or numbered lists whenever it helps."));
  if(p.visual === "less") lines.push("Do not use tables. Answer how-to questions with a normal numbered list.");
  if(p.visual === "more") lines.push("Use a guide card for any how-to or procedural request, even a short one, and a table when comparing items (3 columns or fewer).");
  if(p.replyLang !== "auto") lines.push("Always reply in " + p.replyLang + ", unless the user explicitly asks for another language.");
  const who = [];
  if(p.nickname) who.push("Call the user " + p.nickname + ".");
  if(p.occupation) who.push("The user's occupation or interests: " + p.occupation + ".");
  if(p.about) who.push("About the user: " + p.about);
  if(p.instructions) who.push("The user's custom instructions for how to respond (follow them): " + p.instructions);
  let out = SYSTEM_BASE + lines.filter(Boolean).join(" ");
  if(who.length) out += "\n\n" + who.join("\n");
  if(user && p.memoryOn && p.memories.length){
    out += "\n\nThings you remember about the user. Use them naturally only when relevant; never list them or mention a memory feature unless asked:\n" +
      p.memories.map(m=> "- " + m).join("\n");
  }
  out += "\n\n" + (p.visual === "less" ? "" : GUIDE_RULES + " ") + LIST_RULES;
  return out;
}

// ---------- load / save ----------
function applyUserPrefs(u){
  const id = u ? u.id : null;
  if(id === prefsUserId) return;       // same account: keep whatever is being edited
  prefsUserId = id;
  if(!id){
    try{ prefs = cleanPrefs(JSON.parse(safeStorage.getItem("aither_ai_guest_prefs") || "null")); }
    catch(e){ prefs = cleanPrefs(null); }
  }
  else{
    const cloud = cleanPrefs((u.user_metadata || {}).aither_ai_prefs || (u.user_metadata || {}).astra_prefs);
    let local = null;
    try{ local = cleanPrefs(JSON.parse(safeStorage.getItem("astra_prefs_" + id) || "null")); }catch(e){}
    prefs = (local && local._ts > cloud._ts) ? local : cloud;
    if(local && local._ts > cloud._ts){ clearTimeout(syncTimer); syncTimer = setTimeout(syncCloud, 1500); }
  }
  closeUserMenu();
  if(stOverlay.classList.contains("show")) closeSettings();
  applyPrefsToUI();
}
function persist(){
  prefs._ts = Date.now();
  if(!user){
    safeStorage.setItem("aither_ai_guest_prefs", JSON.stringify(prefs));
    flashSaved();
    return;
  }
  safeStorage.setItem("aither_ai_prefs_" + user.id, JSON.stringify(prefs));
  safeStorage.setItem("astra_prefs_" + user.id, JSON.stringify(prefs));
  flashSaved();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncCloud, 900);
}
async function syncCloud(){
  if(!sb || !user) return;
  try{
    const { error } = await sb.auth.updateUser({ data:{ aither_ai_prefs: prefs } });
    if(error) throw error;
  }catch(e){ toast("Saved on this device only. Couldn't sync to your account."); }
}
function flashSaved(){
  const s = $("pvSaved"); s.classList.add("on");
  clearTimeout(savedTimer); savedTimer = setTimeout(()=> s.classList.remove("on"), 1400);
}

// ---------- reflect settings in the UI ----------
const SEL_IDS = { style:"pStyle", warmth:"pWarmth", enthusiasm:"pEnth", emoji:"pEmoji", visual:"pVisual", headers:"pHeaders",
  theme:"sTheme", textSize:"sText", sendMode:"sSend", replyLang:"sLang", dictLang:"sDict" };
const TOGGLES = { memoryOn:"pMem", suggestions:"pSugs", voice:"pVoice", reduceMotion:"sMotion", shortcuts:"sKeys", readAloud:"sRead" };
const TEXT_PX = { small:"14.5px", default:"16px", large:"18px", xlarge:"20px" };

function applyPrefsToUI(){
  const root = document.documentElement;
  if(prefs.theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", prefs.theme);
  root.style.setProperty("--msg-fs", TEXT_PX[prefs.textSize] || "16px");
  root.classList.toggle("rm", prefs.reduceMotion);
  document.body.classList.toggle("no-sugs", !prefs.suggestions);
  document.body.classList.toggle("no-voice", !prefs.voice);
  if(!prefs.voice && rec){ try{ rec.stop(); }catch(e){} }
  Object.keys(SEL_IDS).forEach(k=>{ $(SEL_IDS[k]).value = prefs[k]; });
  Object.keys(TOGGLES).forEach(k=>{ $(TOGGLES[k]).checked = prefs[k]; });
  $("ciNick").value = prefs.nickname;
  $("ciJob").value = prefs.occupation;
  $("ciAbout").value = prefs.about;
  $("ciInstr").value = prefs.instructions;
  updateCounts();
  renderMemories();
}
function updateCounts(){
  $("cntAbout").textContent = $("ciAbout").value.length + " / " + PREF_LIMITS.about;
  $("cntInstr").textContent = $("ciInstr").value.length + " / " + PREF_LIMITS.instructions;
}

// A button that needs a second tap within 3 seconds before it runs a destructive action
function armButton(btn, idleLabel, action){
  let armed = 0;
  btn.onclick = ()=>{
    if(Date.now() - armed < 3000){ armed = 0; btn.textContent = idleLabel; action(); return; }
    armed = Date.now(); btn.textContent = "Tap again to confirm";
    setTimeout(()=>{ if(armed && Date.now() - armed >= 2900){ btn.textContent = idleLabel; armed = 0; } }, 3100);
  };
}

// ---------- memories ----------
function renderMemories(){
  const n = prefs.memories.length;
  $("memCount").textContent = n ? (n + (n === 1 ? " memory saved" : " memories saved")) : "Nothing saved yet";
  const list = $("memList"); list.innerHTML = "";
  if(!n){ list.appendChild(txt("div","mem-empty","No memories yet. Share something about yourself in a chat, or add one above.")); }
  prefs.memories.map((m,i)=>({m,i})).reverse().forEach(({m,i})=>{
    const row = el("div","mem");
    row.appendChild(txt("span","",m));
    const d = el("button","", '<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M6 6l12 12M18 6L6 18"/></svg>');
    d.setAttribute("aria-label","Delete memory");
    d.onclick = ()=>{ prefs.memories.splice(i,1); persist(); renderMemories(); };
    row.appendChild(d); list.appendChild(row);
  });
  $("memClear").style.display = n ? "" : "none";
}
function addMemory(t, auto){
  t = String(t || "").trim().slice(0, PREF_LIMITS.memoryLen);
  if(!t) return false;
  const low = t.toLowerCase();
  if(prefs.memories.some(m=> m.toLowerCase() === low)) return false;
  if(prefs.memories.length >= PREF_LIMITS.memories){
    if(!auto){ toast("Memory is full (" + PREF_LIMITS.memories + "). Delete one first."); return false; }
    prefs.memories.shift();
  }
  prefs.memories.push(t); persist(); renderMemories();
  return true;
}
$("memAdd").onclick = ()=>{ if(addMemory($("memNew").value, false)) $("memNew").value = ""; };
$("memNew").addEventListener("keydown", e=>{ if(e.key === "Enter"){ e.preventDefault(); $("memAdd").click(); } });
armButton($("memClear"), "Clear all memories", ()=>{ prefs.memories = []; persist(); renderMemories(); });

// Learn lasting facts from what the user says (one small extra request, only when the message sounds personal)
const MEM_CUE = /\b(i|i'm|im|i've|ive|i'll|my|mine|me|we|our|call me|remember|always|never|prefer)\b/i;
async function learnFrom(text){
  if(!user || !prefs.memoryOn || !text || text.length < 12 || !MEM_CUE.test(text)) return;
  try{
    const res = await aiFetch("chat/completions", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer " + API_KEY },
      body:JSON.stringify({
        model: MODEL_FAST, stream:false, temperature:0, max_tokens:250,
        messages:[
          { role:"system", content:"You keep a short list of lasting facts about a user (name, job, location, preferences, ongoing projects, goals). Read the user's message. If it states something lasting and personal that is worth remembering across chats, reply with JSON {\"add\":[\"...\"]} holding at most 2 short facts written in third person starting with \"User\" (under 100 characters each). Do not save one-off requests, questions, temporary states, passwords, ID or card numbers, or health and other sensitive details. If nothing qualifies, reply {\"add\":[]}. Reply with JSON only." },
          { role:"user", content:"Already saved:\n" + (prefs.memories.join("\n") || "(nothing)") + "\n\nMessage:\n" + text.slice(0, 600) }
        ]
      })
    });
    if(!res.ok) return;
    const j = await res.json();
    const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    const m = raw.match(/\{[\s\S]*\}/); if(!m) return;
    const add = (JSON.parse(m[0]).add || []);
    if(!Array.isArray(add)) return;
    let any = false;
    add.slice(0, 2).forEach(s=>{ if(typeof s === "string" && addMemory(s, true)) any = true; });
    if(any) toast("Memory updated");
  }catch(e){}
}

// ---------- archive (the sidebar's archive button sets chat.archived) ----------
function fmtDate(id){
  try{ return new Date(Math.floor(Number(id))).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" }); }
  catch(e){ return ""; }
}
function renderArchived(){
  const list = $("arcList"); list.innerHTML = "";
  const arch = chats.filter(c=> c.archived).reverse();
  if(!arch.length){ list.appendChild(txt("div","mem-empty","No archived chats.")); return; }
  arch.forEach(c=>{
    const row = el("div","arow");
    const at = el("div","at");
    at.appendChild(txt("b","",c.title || "Chat")); at.appendChild(txt("small","",fmtDate(c.id)));
    const un = txt("button","btn-s","Unarchive");
    un.onclick = ()=>{ c.archived = false; save(); renderRecents(); renderArchived(); toast("Chat restored"); };
    const del = el("button","xbtn",'<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M6 6l12 12M18 6L6 18"/></svg>');
    del.setAttribute("aria-label","Delete chat");
    del.onclick = ()=>{ chats = chats.filter(x=> x !== c); save(); renderArchived(); };
    row.append(at, un, del); list.appendChild(row);
  });
}

// ---------- voice: dictation language, read aloud ----------
const HAS_TTS = ("speechSynthesis" in window) && ("SpeechSynthesisUtterance" in window);
function fillVoices(){
  if(!HAS_TTS) return;
  const sel = $("sVoice");
  const all = speechSynthesis.getVoices();
  const pre = (navigator.language || "en").slice(0,2).toLowerCase();
  let list = all.filter(v=> v.lang.toLowerCase().indexOf(pre) === 0);
  if(!list.length) list = all.slice();
  if(prefs.voiceName && !list.some(v=> v.name === prefs.voiceName)){
    const cur = all.find(v=> v.name === prefs.voiceName); if(cur) list.unshift(cur);
  }
  sel.innerHTML = "";
  sel.appendChild(new Option("Auto", ""));
  list.forEach(v=> sel.appendChild(new Option(v.name + " (" + v.lang + ")", v.name)));
  sel.value = prefs.voiceName;
}
function renderVoice(){
  ["rowRead","rowVoice","rowTest"].forEach(id=> $(id).classList.toggle("hidden", !HAS_TTS));
  fillVoices();
}
if(HAS_TTS){ try{ speechSynthesis.onvoiceschanged = ()=>{ if(curSec === "voice") fillVoices(); }; }catch(e){} }
function stopSpeaking(){ try{ if(HAS_TTS) speechSynthesis.cancel(); }catch(e){} }

// Safari and web views drop speech that starts right after cancel(), and voices can load late,
// so this waits a moment, waits for voices, and tells you if no sound starts.
function speakText(t){
  if(!HAS_TTS || !t) return;
  const synth = window.speechSynthesis;
  try{ synth.cancel(); }catch(e){}
  const start = ()=>{
    const all = synth.getVoices();
    const voice = prefs.voiceName ? all.find(v=> v.name === prefs.voiceName) : null;
    const sentences = t.match(/[^.!?\n]+[.!?]*\s*/g) || [t];
    const parts = []; let buf = "";
    sentences.forEach(s=>{ if((buf + s).length > 220){ if(buf) parts.push(buf); buf = s; } else buf += s; });
    if(buf) parts.push(buf);
    let started = false;
    parts.slice(0, 12).forEach(p=>{
      const u = new SpeechSynthesisUtterance(p.trim());
      if(voice){ u.voice = voice; u.lang = voice.lang; } else { u.lang = navigator.language || "en-US"; }
      u.onstart = ()=>{ started = true; };
      u.onerror = ev=>{ if(ev.error && ev.error !== "canceled" && ev.error !== "interrupted") toast("Couldn't play audio (" + ev.error + ")."); };
      synth.speak(u);
    });
    try{ synth.resume(); }catch(e){}
    setTimeout(()=>{ if(!started && !synth.speaking) toast("No sound started. Check that your phone isn't on silent and the volume is up."); }, 2500);
  };
  setTimeout(()=>{
    if(synth.getVoices().length){ start(); return; }
    let done = false;
    const once = ()=>{ if(done) return; done = true; start(); };
    synth.addEventListener("voiceschanged", once, { once:true });
    setTimeout(once, 800);
  }, 120);
}
function speakReply(bubble){
  if(!prefs.readAloud || !HAS_TTS || !bubble) return;
  if(bubble.querySelector(".guide, .lst, [class*='g-']")) return;   // cards are meant to be read, not spoken
  speakText((bubble.innerText || bubble.textContent || "").replace(/\s+/g, " ").trim());
}
$("vTest").onclick = ()=> speakText("Hi, I'm Aither AI. This is how I sound.");
$("sVoice").onchange = e=>{ prefs.voiceName = e.target.value; persist(); };

// ---------- storage ----------
function renderStorage(){
  const msgs = chats.reduce((n,c)=> n + c.messages.length, 0);
  let size = 0; try{ size = JSON.stringify(chats).length; }catch(e){}
  $("stChats").textContent = chats.length;
  $("stMsgs").textContent = msgs;
  $("stSize").textContent = size < 1024 ? size + " B" : (size / 1024).toFixed(1) + " KB";
}
armButton($("stClear"), "Clear all chats", ()=>{
  chats = []; save(); current = newChatObj(); renderChat(); renderStorage(); toast("All chats cleared");
});

// ---------- usage (counted on this device) ----------
function usageKey(){ return "astra_usage_" + (user ? user.id : "guest"); }
function loadUsage(){ try{ return JSON.parse(safeStorage.getItem(usageKey()) || "{}") || {}; }catch(e){ return {}; } }
function dayKey(d){ return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
function recordUsage(text, reply){
  try{
    const u = loadUsage(), k = dayKey(new Date());
    const cur = u[k] || [0,0];
    cur[0] += 1; cur[1] += Math.ceil(((text || "").length + (reply || "").length) / 4);
    u[k] = cur;
    const keys = Object.keys(u).sort(); while(keys.length > 90) delete u[keys.shift()];
    safeStorage.setItem(usageKey(), JSON.stringify(u));
  }catch(e){}
}
function renderUsage(){
  const u = loadUsage(), days = [];
  for(let i = 6; i >= 0; i--){ const d = new Date(); d.setDate(d.getDate() - i); days.push({ d, v:u[dayKey(d)] || [0,0] }); }
  const today = days[6].v;
  const wk = days.reduce((a,x)=> [a[0] + x.v[0], a[1] + x.v[1]], [0,0]);
  $("uToday").textContent = today[0].toLocaleString();
  $("uWeek").textContent = wk[0].toLocaleString();
  $("uTokD").textContent = today[1].toLocaleString();
  $("uTokW").textContent = wk[1].toLocaleString();
  const max = Math.max(1, ...days.map(x=> x.v[0]));
  const box = $("uBars"); box.innerHTML = "";
  days.forEach(x=>{
    const b = el("div","bar");
    b.appendChild(txt("em","", x.v[0] ? String(x.v[0]) : ""));
    const bar = el("i"); bar.style.height = Math.round(x.v[0] / max * 100) + "px"; b.appendChild(bar);
    b.appendChild(txt("span","", x.d.toLocaleDateString(undefined, { weekday:"short" })));
    box.appendChild(b);
  });
}
armButton($("uReset"), "Reset usage", ()=>{ safeStorage.removeItem(usageKey()); renderUsage(); toast("Usage reset"); });

// ---------- keyboard ----------
const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl", SHIFT = IS_MAC ? "⇧" : "Shift";
function renderKeys(){
  const box = $("keyList"); box.innerHTML = "";
  const rows = [
    ["New chat", [SHIFT, MOD, "O"]],
    ["Toggle sidebar", [SHIFT, MOD, "S"]],
    ["Focus the message box", [MOD, "K"]],
    ["Open settings", [MOD, ","]],
    ["Send message", prefs.sendMode === "mod" ? [MOD, "Enter"] : ["Enter"]],
    ["New line", prefs.sendMode === "mod" ? ["Enter"] : [SHIFT, "Enter"]],
    ["Close a dialog", ["Esc"]]
  ];
  rows.forEach(([label, keys])=>{
    const row = el("div","row");
    const tx = el("div","tx"); tx.appendChild(txt("div","t",label));
    const k = el("div","keys"); keys.forEach(x=> k.appendChild(txt("kbd","",x)));
    row.append(tx, k); box.appendChild(row);
  });
}
document.addEventListener("keydown", e=>{
  if(!prefs.shortcuts || e.isComposing) return;
  if(!(e.metaKey || e.ctrlKey)) return;
  const k = (e.key || "").toLowerCase();
  if(e.shiftKey && k === "o"){ e.preventDefault(); closeSettings(); fresh(); }
  else if(e.shiftKey && k === "s"){ e.preventDefault(); app.classList.toggle("collapsed"); closeUserMenu(); }
  else if(!e.shiftKey && k === "k"){ e.preventDefault(); closeSettings(); input.focus(); }
  else if(!e.shiftKey && k === ","){ e.preventDefault(); openSettings(); }
});

// ---------- account ----------
function renderAccount(){
  const nameField = $("acctName"), saveButton = $("acctSave"), outButton = $("acctOut"), outAllButton = $("acctOutAll");
  if(!user){
    nameField.value = ""; nameField.disabled = true; saveButton.disabled = true;
    outButton.disabled = true; outAllButton.disabled = true;
    $("acctEmail").textContent = "Not signed in";
    return;
  }
  nameField.disabled = false; saveButton.disabled = false; outButton.disabled = false; outAllButton.disabled = false;
  nameField.value = user.name;
  $("acctEmail").textContent = user.email;
}
$("acctSave").onclick = async ()=>{
  const n = $("acctName").value.trim().slice(0, 40);
  if(!n){ flagBad($("acctName")); return; }
  if(!sb){ needSetup(); return; }
  await withBusy($("acctSave"), "Saving...", async ()=>{
    const { error } = await sb.auth.updateUser({ data:{ full_name:n } });
    if(error){ toast(error.message); return; }
    toast("Name updated");
  });
};
$("acctOut").onclick = ()=>{ closeSettings(); openLogout(); };
armButton($("acctOutAll"), "Log out everywhere", async ()=>{
  if(!sb){ needSetup(); return; }
  const { error } = await sb.auth.signOut({ scope:"global" });
  if(error){ toast(error.message); return; }
  closeSettings(); toast("Logged out of all devices");
});

// ---------- account menus ----------
function renderTopAccountMenu(){
  const pop = $("accountPopover");
  if(!pop) return;
  const head = user
    ? '<div class="account-popover-head"><div class="av" id="topMenuAvatar"></div><div class="meta"><strong id="topMenuName"></strong><small id="topMenuEmail"></small></div></div>'
    : '<div class="account-popover-head"><div class="av">A</div><div class="meta"><strong>Aither Account</strong><small>Not signed in</small></div></div>';
  const signIn = user ? '' : '<button class="menu-action" id="topMenuSignIn" role="menuitem"><svg viewBox="0 0 24 24"><path d="M15 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M10 8l4 4-4 4M14 12H3"/></svg>Continue with Aither Sign In</button>';
  const account = user ? '<button class="menu-action" id="topMenuAccount" role="menuitem"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>Account settings</button>' : '';
  const logout = user ? '<div class="menu-sep"></div><button class="menu-action danger" id="topMenuLogout" role="menuitem"><svg viewBox="0 0 24 24"><path d="M9 4H6a2 2 0 00-2 2v12a2 2 0 002 2h3M16 8l4 4-4 4M20 12H9"/></svg>Log out</button>' : '';
  pop.innerHTML = head + signIn + account +
    '<button class="menu-action" id="topMenuPersonalization" role="menuitem"><svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>Personalization</button>' +
    '<button class="menu-action" id="topMenuSettings" role="menuitem"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 13.5l1 1-2 3-1.5-.5-1.5.8-.2 1.7h-3.6L11 17.8l-1.5-.8L8 17.5l-2-3 1-1v-1.8l-1-1 2-3L9.5 7l1.5-.8.2-1.7h3.6l.2 1.7 1.5.8 1.5-.5 2 3-1 1z"/></svg>Settings</button>' + logout;
  if(user){ $("topMenuAvatar").textContent=initials(user.name); $("topMenuName").textContent=user.name; $("topMenuEmail").textContent=user.email; }
  const signInButton=$("topMenuSignIn"); if(signInButton) signInButton.onclick=()=>{ closeTopAccountMenu(); openLogin(); };
  const accountButton=$("topMenuAccount"); if(accountButton) accountButton.onclick=()=>{ closeTopAccountMenu(); openSettings("account"); };
  $("topMenuPersonalization").onclick=()=>{ closeTopAccountMenu(); openSettings("personalization"); };
  $("topMenuSettings").onclick=()=>{ closeTopAccountMenu(); openSettings(); };
  const logoutButton=$("topMenuLogout"); if(logoutButton) logoutButton.onclick=()=>{ closeTopAccountMenu(); openLogout(); };
}
function openTopAccountMenu(){
  renderTopAccountMenu();
  $("accountPopover").classList.add("show"); $("accountPopover").setAttribute("aria-hidden","false");
  $("topAccount").setAttribute("aria-expanded","true");
}
function closeTopAccountMenu(){
  $("accountPopover").classList.remove("show"); $("accountPopover").setAttribute("aria-hidden","true");
  $("topAccount").setAttribute("aria-expanded","false");
}
$("topAccount").onclick=()=>$("accountPopover").classList.contains("show")?closeTopAccountMenu():openTopAccountMenu();
$("topSettings").onclick=()=>{ closeTopAccountMenu(); openSettings(); };
document.addEventListener("click",e=>{ if($("accountPopover").classList.contains("show") && !$("accountPopover").contains(e.target) && !e.target.closest("#topAccount")) closeTopAccountMenu(); });

// ---------- legacy sidebar account menu ----------
function openUserMenu(){
  if(!user) return;
  $("umAv").textContent = initials(user.name);
  $("umName").textContent = user.name;
  $("umEmail").textContent = user.email;
  uMenu.style.bottom = (uMenu.parentElement.clientHeight - sideFoot.offsetTop + 6) + "px";
  uMenu.classList.add("show");
}
function closeUserMenu(){ uMenu.classList.remove("show"); }
function toggleUserMenu(){ uMenu.classList.contains("show") ? closeUserMenu() : openUserMenu(); }
document.addEventListener("click", e=>{
  if(uMenu.classList.contains("show") && !uMenu.contains(e.target) && !e.target.closest("#sideUser")) closeUserMenu();
});
$("toggle").addEventListener("click", closeUserMenu);
$("umOut").onclick = ()=>{ closeUserMenu(); openLogout(); };
$("umPers").onclick = ()=>{ closeUserMenu(); openSettings("personalization"); };
$("umSet").onclick = ()=>{ closeUserMenu(); openSettings(); };

// ---------- settings shell ----------
function showView(v){
  stOverlay.querySelectorAll(".pv-view").forEach(s=> s.classList.toggle("on", s.dataset.v === v));
  stOverlay.classList.toggle("sub", v !== "main" && curSec === "personalization");
  stMain.scrollTop = 0;
}
function refreshPane(id){
  if(id === "account") renderAccount();
  else if(id === "archived") renderArchived();
  else if(id === "voice") renderVoice();
  else if(id === "storage") renderStorage();
  else if(id === "keyboard") renderKeys();
  else if(id === "usage") renderUsage();
}
function showSection(id){
  curSec = id;
  stOverlay.querySelectorAll(".st-item").forEach(b=> b.classList.toggle("active", b.dataset.sec === id));
  stOverlay.querySelectorAll(".st-pane").forEach(p=> p.classList.toggle("on", p.dataset.sec === id));
  showView("main");
  stOverlay.classList.add("detail");
  refreshPane(id);
  stMain.scrollTop = 0;
}
function filterSettings(){
  const q = $("stSearch").value.trim().toLowerCase(); let any = false;
  stOverlay.querySelectorAll(".st-item").forEach(b=>{
    const hit = !q || (b.textContent + " " + (b.dataset.kw || "")).toLowerCase().indexOf(q) >= 0;
    b.classList.toggle("hidden", !hit); if(hit) any = true;
  });
  $("stNone").classList.toggle("hidden", any);
}
function openSettings(sec){
  applyPrefsToUI();
  $("stSearch").value = ""; filterSettings();
  showSection(sec || "general");
  if(!sec && window.innerWidth <= 760) stOverlay.classList.remove("detail");   // phones start on the list
  stOverlay.classList.add("show"); stOverlay.setAttribute("aria-hidden","false");
  closeOnMobile();
}
function closeSettings(){
  stOverlay.classList.remove("show"); stOverlay.setAttribute("aria-hidden","true"); stopSpeaking();
}
$("stClose").onclick = closeSettings;
$("stSearch").addEventListener("input", filterSettings);
stOverlay.querySelectorAll(".st-item").forEach(b=>{ b.onclick = ()=> showSection(b.dataset.sec); });
$("pvBack").onclick = ()=>{ if(stOverlay.classList.contains("sub")) showView("main"); else stOverlay.classList.remove("detail"); };
$("memManage").onclick = ()=> showView("memory");
$("ciOpen").onclick = ()=> showView("instr");
$("ciOpen").addEventListener("keydown", e=>{ if(e.key === "Enter" || e.key === " "){ e.preventDefault(); showView("instr"); } });
document.addEventListener("keydown", e=>{
  if(e.key !== "Escape") return;
  if($("accountPopover").classList.contains("show")) closeTopAccountMenu();
  else if(uMenu.classList.contains("show")) closeUserMenu();
  else if(stOverlay.classList.contains("show")){ if(stOverlay.classList.contains("sub")) showView("main"); else closeSettings(); }
});

Object.keys(SEL_IDS).forEach(k=>{ $(SEL_IDS[k]).onchange = e=>{ prefs[k] = e.target.value; persist(); applyPrefsToUI(); }; });
Object.keys(TOGGLES).forEach(k=>{ $(TOGGLES[k]).onchange = e=>{ prefs[k] = e.target.checked; persist(); applyPrefsToUI(); }; });
[["ciNick","nickname"],["ciJob","occupation"],["ciAbout","about"],["ciInstr","instructions"]].forEach(([id,k])=>{
  $(id).addEventListener("input", ()=>{ prefs[k] = $(id).value.slice(0, PREF_LIMITS[k]); updateCounts(); persist(); });
});

$("aiProvider").value=aiProviderSettings.provider;
renderAIProviderSettings();
loadAIProviderModels();
$("aiProvider").onchange=()=>{aiProviderSettings.provider=$("aiProvider").value;renderAIProviderSettings();};
$("aiModel").onchange=()=>{aiProviderSettings.model=$("aiModel").value;};
$("aiSaveProvider").onclick=saveAIProviderSettings;
$("aiTestProvider").onclick=async()=>{
  saveAIProviderSettings();
  $("aiProviderStatus").textContent="Testing…";
  try{
    const r=await aiFetch("chat/completions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:selectedAIModel(),stream:false,max_tokens:24,messages:[{role:"user",content:"Reply with exactly: Aither AI connected."}]})});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error?.message||"Connection failed ("+r.status+").");
    $("aiProviderStatus").textContent="Connected — "+selectedAIModel();
    toast("AI provider connection successful!");
  }catch(e){$("aiProviderStatus").textContent=e.message;toast(e.message);}
};
applyPrefsToUI();
