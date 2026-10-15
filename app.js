/* 家庭月曆帳本 — 主程式
 * 有 Firebase 設定時：帳號登入 + 雲端同步；沒有設定時：示範模式（資料存在本機）。 */
(function () {
"use strict";

const FIREBASE_VERSION = "10.12.2";
const OUT_CATS = ["餐飲", "日用品", "交通", "居家水電", "教育", "醫療", "娛樂", "其他"];
const IN_CATS = ["薪資", "獎金", "其他收入"];
const DEFAULT_PEOPLE = ["爸爸", "媽媽", "孩子"];
const WD = "日一二三四五六";
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const money = n => "NT$ " + Math.round(n).toLocaleString("zh-TW");
const now = new Date();
const todayISO = iso(now.getFullYear(), now.getMonth(), now.getDate());

/* ---------- 狀態 ---------- */
let store = null;            // 資料存取（本機或 Firebase）
let events = [], txns = [], people = DEFAULT_PEOPLE.slice();
let famName = "", famId = "", memberNames = {}, memberCount = 0;
let vy = now.getFullYear(), vm = now.getMonth(), sel = todayISO, kind = "event", armed = null;

const mColor = name => { const i = people.indexOf(name); return `var(--m${(i < 0 ? 5 : i) % 6})`; };
const monthKey = () => `${vy}-${pad(vm + 1)}`;

function show(name) {
  for (const s of ["Loading", "Auth", "Family", "App"]) $("screen" + s).hidden = s !== name;
}
function notice(text) { $("notice").textContent = text || ""; $("notice").hidden = !text; }

/* ---------- 畫面 ---------- */
function render() {
  if ($("screenApp").hidden) return;
  $("famName").textContent = famName || "家庭月曆帳本";
  $("mlabel").textContent = `${vy}年${vm + 1}月`;
  $("roc").textContent = `民國${vy - 1911}年`;
  const mk = monthKey();
  const mt = txns.filter(t => t.date && t.date.startsWith(mk));
  const me = events.filter(e => e.date && e.date.startsWith(mk));
  const out = mt.filter(t => t.kind === "out").reduce((a, t) => a + (+t.amount || 0), 0);
  const inc = mt.filter(t => t.kind === "in").reduce((a, t) => a + (+t.amount || 0), 0);
  $("sOut").textContent = money(out);
  $("sIn").textContent = money(inc);
  $("sNet").textContent = (inc - out < 0 ? "−" : "") + money(Math.abs(inc - out));
  $("sEv").textContent = me.length + " 件";
  renderGrid(); renderDay(); renderUpcoming(); renderLedger(mt); renderPeople(); renderInvite();
}

function renderGrid() {
  const start = new Date(vy, vm, 1).getDay(), dim = new Date(vy, vm + 1, 0).getDate();
  const rows = Math.ceil((start + dim) / 7), cells = [], evBy = {}, outBy = {};
  events.forEach(e => (evBy[e.date] ??= []).push(e));
  txns.forEach(t => { if (t.kind === "out") outBy[t.date] = (outBy[t.date] || 0) + (+t.amount || 0); });
  for (let i = 0; i < rows * 7; i++) {
    const dt = new Date(vy, vm, 1 - start + i), s = iso(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const evs = (evBy[s] || []).slice().sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
    const chips = evs.slice(0, 2).map(e => `<span class="chip" style="--mc:${mColor(e.member)}">${e.time ? esc(e.time) + " " : ""}${esc(e.title)}</span>`).join("");
    const more = evs.length > 2 ? `<span class="more">還有 ${evs.length - 2} 件</span>` : "";
    const dots = evs.length ? `<span class="dots">${evs.slice(0, 4).map(e => `<i style="--mc:${mColor(e.member)}"></i>`).join("")}</span>` : "";
    const amt = outBy[s] ? `<span class="amt num">−${Math.round(outBy[s]).toLocaleString("zh-TW")}</span>` : "";
    const label = `${dt.getMonth() + 1}月${dt.getDate()}日，${evs.length}件活動${outBy[s] ? "，支出" + outBy[s] + "元" : ""}`;
    cells.push(`<button class="cell${dt.getMonth() === vm ? "" : " out"}${s === todayISO ? " is-today" : ""}${s === sel ? " sel" : ""}" data-date="${s}" aria-label="${label}"><span class="d num">${dt.getDate()}</span>${chips}${more}${dots}${amt}</button>`);
  }
  $("grid").innerHTML = cells.join("");
}

const delBtn = (col, id) => { const k = col + "/" + id, on = armed === k; return `<button class="del${on ? " arm" : ""}" data-del="${esc(k)}">${on ? "確定刪除" : "刪除"}</button>`; };
const itemEvent = e => `<li><span class="bar" style="--mc:${mColor(e.member)}"></span><div class="main"><b>${esc(e.title)}</b><small>${e.time ? esc(e.time) + " · " : "整天 · "}${esc(e.member || "全家")}</small></div>${delBtn("events", e.id)}</li>`;
const itemTx = t => {
  const sign = t.kind === "out" ? "−" : "+", cls = t.kind === "out" ? "c-spend" : "c-earn";
  return `<li><span class="bar" style="--mc:${mColor(t.member)}"></span><div class="main"><b>${esc(t.note || t.cat)}</b><small>${esc(t.cat)} · ${esc(t.member || "")}</small></div><span class="val num ${cls}">${sign}${Math.round(+t.amount).toLocaleString("zh-TW")}</span>${delBtn("txns", t.id)}</li>`;
};

function renderDay() {
  const d = parseISO(sel);
  $("dayTitle").textContent = `${d.getMonth() + 1}月${d.getDate()}日 星期${WD[d.getDay()]}${sel === todayISO ? "（今天）" : ""}`;
  const evs = events.filter(e => e.date === sel).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  const tx = txns.filter(t => t.date === sel);
  const spent = tx.filter(t => t.kind === "out").reduce((a, t) => a + (+t.amount || 0), 0);
  $("dayBody").innerHTML =
    `<h3>行程</h3>` + (evs.length ? `<ul class="list">${evs.map(itemEvent).join("")}</ul>` : `<p class="empty">這天沒有安排，用下方表單新增一個活動。</p>`) +
    `<h3>收支${spent ? ` · 支出 <span class="num c-spend">${money(spent)}</span>` : ""}</h3>` +
    (tx.length ? `<ul class="list">${tx.map(itemTx).join("")}</ul>` : `<p class="empty">這天還沒有記帳。</p>`);
}

function renderUpcoming() {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
  const endISO = iso(end.getFullYear(), end.getMonth(), end.getDate());
  const up = events.filter(e => e.date >= todayISO && e.date <= endISO)
    .sort((a, b) => (a.date + (a.time || "99")).localeCompare(b.date + (b.time || "99")));
  $("upList").innerHTML = up.length ? up.slice(0, 10).map(e => {
    const d = parseISO(e.date);
    return `<li><span class="bar" style="--mc:${mColor(e.member)}"></span><div class="main"><b>${esc(e.title)}</b><small class="num">${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）${e.time ? " " + esc(e.time) : ""} · ${esc(e.member || "全家")}</small></div></li>`;
  }).join("") : `<li class="empty">兩週內還沒有活動。</li>`;
}

function bars(map, color) {
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1]), max = rows[0]?.[1] || 1;
  return rows.length ? rows.map(([k, v]) => `<div class="brow"><span>${esc(k)}</span><span class="btrack"><i style="width:${(v / max * 100).toFixed(1)}%;${color ? `background:${color(k)}` : ""}"></i></span><span class="num">${money(v)}</span></div>`).join("")
    : `<p class="empty">本月還沒有支出紀錄。</p>`;
}
function renderLedger(mt) {
  const byCat = {}, byMem = {};
  mt.filter(t => t.kind === "out").forEach(t => {
    byCat[t.cat] = (byCat[t.cat] || 0) + (+t.amount || 0);
    const m = t.member || "未指定"; byMem[m] = (byMem[m] || 0) + (+t.amount || 0);
  });
  $("catBars").innerHTML = bars(byCat);
  $("memBars").innerHTML = bars(byMem, mColor);
  const sorted = mt.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  if (!sorted.length) { $("txList").innerHTML = `<p class="empty">${vm + 1}月還沒有收支。點月曆上的日期，再用表單記一筆。</p>`; return; }
  let html = "", cur = "";
  sorted.forEach(t => {
    if (t.date !== cur) { if (cur) html += "</ul>"; cur = t.date; const d = parseISO(cur); html += `<div class="dategroup num">${d.getMonth() + 1}月${d.getDate()}日 星期${WD[d.getDay()]}</div><ul class="list">`; }
    html += itemTx(t);
  });
  $("txList").innerHTML = html + "</ul>";
}

function renderPeople() {
  $("mChips").innerHTML = people.map(m => `<span class="mchip"><i style="--mc:${mColor(m)}"></i>${esc(m)}${people.length > 1 ? `<button type="button" data-rm="${esc(m)}" aria-label="移除${esc(m)}">×</button>` : ""}</span>`).join("");
  const keep = $("fWho").value;
  $("fWho").innerHTML = (kind === "event" ? `<option value="全家">全家</option>` : "") + people.map(m => `<option>${esc(m)}</option>`).join("");
  if ([...$("fWho").options].some(o => o.value === keep)) $("fWho").value = keep;
}

function renderInvite() {
  if (!famId) return;
  $("invCode").textContent = famId.replace(/(.{4})(?=.)/g, "$1-");
  const names = Object.values(memberNames).filter(Boolean);
  $("famCount").textContent = `目前 ${memberCount} 位家人已加入${names.length ? "：" + names.join("、") : ""}`;
}

function setKind(k) {
  kind = k;
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.kind === k)));
  const ev = k === "event";
  $("fTimeWrap").hidden = !ev; $("fAmtWrap").hidden = ev; $("fCatWrap").hidden = ev;
  $("fTitleLbl").textContent = ev ? "活動名稱" : "備註（可不填）";
  $("fTitle").placeholder = ev ? "例如：小孩家長會" : (k === "out" ? "例如：全聯採買" : "例如：十月薪水");
  $("fWhoLbl").textContent = ev ? "誰的行程" : (k === "out" ? "誰付的" : "誰的收入");
  $("fCat").innerHTML = (k === "in" ? IN_CATS : OUT_CATS).map(c => `<option>${c}</option>`).join("");
  $("fSubmit").textContent = ev ? "新增活動" : (k === "out" ? "記一筆支出" : "記一筆收入");
  $("fMsg").textContent = "";
  renderPeople();
}

function setTab(t) {
  $("tabCal").setAttribute("aria-selected", String(t === "cal"));
  $("tabLed").setAttribute("aria-selected", String(t === "led"));
  $("calView").hidden = t !== "cal"; $("ledView").hidden = t !== "led";
  if (t === "led" && kind === "event") setKind("out");
  try { localStorage.setItem("fam-tab", t); } catch (_) {}
}

function writeError(e) {
  const code = e && e.code;
  if (code === "permission-denied") notice("沒有權限儲存。你可能已不在這個家庭，請重新開啟 App。");
  else notice("儲存失敗，請檢查網路後再試一次。");
}

/* ---------- 主畫面操作 ---------- */
function wireApp() {
  $("prev").onclick = () => { vm--; if (vm < 0) { vm = 11; vy--; } render(); };
  $("next").onclick = () => { vm++; if (vm > 11) { vm = 0; vy++; } render(); };
  $("today").onclick = () => { vy = now.getFullYear(); vm = now.getMonth(); sel = todayISO; $("fDate").value = sel; render(); };
  $("grid").addEventListener("click", e => {
    const c = e.target.closest(".cell"); if (!c) return;
    sel = c.dataset.date; const d = parseISO(sel);
    if (d.getMonth() !== vm) { vy = d.getFullYear(); vm = d.getMonth(); }
    $("fDate").value = sel; armed = null; render();
  });
  $("tabCal").onclick = () => setTab("cal");
  $("tabLed").onclick = () => setTab("led");
  document.querySelectorAll(".seg button").forEach(b => b.onclick = () => setKind(b.dataset.kind));

  document.addEventListener("click", e => {
    if ($("screenApp").hidden) return;
    const b = e.target.closest("[data-del]");
    if (b) {
      const k = b.dataset.del;
      if (armed !== k) { armed = k; render(); return; }
      armed = null;
      const [col, id] = k.split("/");
      Promise.resolve(store.remove(col, id)).catch(writeError);
      return;
    }
    if (armed && !e.target.closest(".del")) { armed = null; render(); }
    const r = e.target.closest("[data-rm]");
    if (r) Promise.resolve(store.setPeople(people.filter(m => m !== r.dataset.rm))).catch(writeError);
  });

  $("mAdd").onclick = () => {
    const v = $("mNew").value.trim();
    if (!v || people.includes(v)) return;
    Promise.resolve(store.setPeople([...people, v].slice(0, 12))).catch(writeError);
    $("mNew").value = "";
  };

  $("addForm").addEventListener("submit", e => {
    e.preventDefault();
    const date = $("fDate").value, title = $("fTitle").value.trim(), who = $("fWho").value;
    if (!date) { $("fMsg").textContent = "請選擇日期。"; return; }
    let col, data;
    if (kind === "event") {
      if (!title) { $("fMsg").textContent = "請輸入活動名稱。"; $("fTitle").focus(); return; }
      col = "events"; data = { date, time: $("fTime").value || "", title, member: who, createdAt: Date.now() };
    } else {
      const amt = Math.round(Number($("fAmt").value));
      if (!(amt > 0)) { $("fMsg").textContent = "請輸入大於 0 的金額。"; $("fAmt").focus(); return; }
      col = "txns"; data = { date, kind, amount: amt, cat: $("fCat").value, note: title, member: who, createdAt: Date.now() };
    }
    // 不等雲端回應：沒網路時也會先顯示，連上後自動上傳
    Promise.resolve(store.add(col, data)).catch(writeError);
    $("fTitle").value = ""; $("fAmt").value = ""; $("fTime").value = ""; $("fMsg").textContent = "";
    sel = date; render();
  });

  /* 邀請 */
  const copy = (text, okMsg) => {
    const done = () => { $("copyMsg").textContent = okMsg; setTimeout(() => $("copyMsg").textContent = "", 2500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => { $("copyMsg").textContent = "請長按邀請碼自行複製"; });
    else $("copyMsg").textContent = "請長按邀請碼自行複製";
  };
  $("copyCode").onclick = () => copy(famId, "已複製邀請碼");
  $("copyLink").onclick = () => copy(`${location.origin}${location.pathname}#join=${famId}`, "已複製邀請連結");

  /* 備份 */
  $("exportBtn").onclick = () => {
    const strip = o => { const { id, ...rest } = o; return rest; };
    const payload = { app: "family-ledger", version: 1, exportedAt: new Date().toISOString(), familyName: famName, people, events: events.map(strip), txns: txns.map(strip) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `家庭帳本備份-${todayISO}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $("importFile").onchange = async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const evKey = x => [x.date, x.time || "", x.title].join("|");
      const txKey = x => [x.date, x.kind, x.amount, x.cat, x.note || ""].join("|");
      const haveE = new Set(events.map(evKey)), haveT = new Set(txns.map(txKey));
      const okDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
      const newE = (data.events || []).filter(x => okDate(x.date) && x.title && !haveE.has(evKey(x)))
        .map(x => ({ date: x.date, time: x.time || "", title: String(x.title).slice(0, 60), member: x.member || "全家", createdAt: x.createdAt || Date.now() }));
      const newT = (data.txns || []).filter(x => okDate(x.date) && (x.kind === "out" || x.kind === "in") && +x.amount > 0 && !haveT.has(txKey(x)))
        .map(x => ({ date: x.date, kind: x.kind, amount: Math.round(+x.amount), cat: x.cat || "其他", note: x.note || "", member: x.member || "", createdAt: x.createdAt || Date.now() }));
      const skipped = (data.events || []).length + (data.txns || []).length - newE.length - newT.length;
      // 匯入時順便把檔案裡的家人標籤補進來
      const morePeople = (data.people || []).filter(p => typeof p === "string" && !people.includes(p));
      [...newE, ...newT].forEach(x => { if (x.member && x.member !== "全家" && !people.includes(x.member) && !morePeople.includes(x.member)) morePeople.push(x.member); });
      if (morePeople.length) await store.setPeople([...people, ...morePeople].slice(0, 12));
      await store.importItems(newE, newT);
      $("ioMsg").textContent = `已匯入 ${newE.length} 筆活動、${newT.length} 筆收支${skipped > 0 ? `（略過 ${skipped} 筆重複或格式不對的資料）` : ""}。`;
    } catch (err) {
      $("ioMsg").textContent = err && err.code ? "匯入失敗，請檢查網路後再試。" : "這個檔案無法讀取，請選擇本 App 下載的備份檔（.json）。";
    }
  };

  $("fDate").value = sel;
  setKind("event");
  try { if (localStorage.getItem("fam-tab") === "led") setTab("led"); } catch (_) {}
}

/* ---------- 示範模式（沒有 Firebase 設定） ---------- */
function startDemo() {
  const KEY = "family-ledger-demo";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_) {}
  events = saved.events || []; txns = saved.txns || []; people = saved.people || DEFAULT_PEOPLE.slice();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ events, txns, people })); } catch (_) {} render(); };
  const newId = () => "d" + Math.random().toString(36).slice(2, 10);
  store = {
    add(col, data) { (col === "events" ? events : txns).push({ id: newId(), ...data }); persist(); },
    remove(col, id) { const arr = col === "events" ? events : txns; const i = arr.findIndex(x => x.id === id); if (i >= 0) arr.splice(i, 1); persist(); },
    setPeople(list) { people = list; persist(); },
    importItems(es, ts) { es.forEach(x => events.push({ id: newId(), ...x })); ts.forEach(x => txns.push({ id: newId(), ...x })); persist(); }
  };
  famName = "家庭月曆帳本";
  $("whoami").textContent = "示範模式";
  $("inviteSec").hidden = true; $("accountSec").hidden = true;
  show("App");
  notice("示範模式：還沒填入 Firebase 設定，資料只存在這台裝置。照著安裝說明設定好之後，全家就能同步。");
  render();
}

/* ---------- Firebase 模式 ---------- */
async function startFirebase(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  let A, S, F;
  try {
    [F, A, S] = await Promise.all([import(base + "firebase-app.js"), import(base + "firebase-auth.js"), import(base + "firebase-firestore.js")]);
  } catch (e) {
    show("Auth"); $("aMsg").textContent = "無法載入登入元件，請確認網路連線後重新開啟。"; return;
  }
  const app = F.initializeApp(cfg);
  const auth = A.getAuth(app);
  let db;
  try { db = S.initializeFirestore(app, { localCache: S.persistentLocalCache({ tabManager: S.persistentMultipleTabManager() }) }); }
  catch (_) { db = S.getFirestore(app); }

  let me = null, pendingName = "", unsubs = [];
  const stopAll = () => { unsubs.forEach(u => u()); unsubs = []; };

  /* 邀請連結 #join=XXXX */
  const m = location.hash.match(/join=([A-Za-z0-9-]+)/);
  if (m) { try { sessionStorage.setItem("fam-join", m[1]); } catch (_) {} history.replaceState(null, "", location.pathname); }
  const pendingJoin = () => { try { return sessionStorage.getItem("fam-join") || ""; } catch (_) { return ""; } };

  /* 登入畫面 */
  let mode = "in";
  const setMode = md => {
    mode = md;
    $("authTabIn").setAttribute("aria-selected", String(md === "in"));
    $("authTabUp").setAttribute("aria-selected", String(md === "up"));
    $("aNameWrap").hidden = md !== "up";
    $("aReset").hidden = md !== "in";
    $("aSubmit").textContent = md === "in" ? "登入" : "建立帳號";
    $("aPass").autocomplete = md === "in" ? "current-password" : "new-password";
    $("aMsg").textContent = ""; $("aMsg").className = "msg";
  };
  $("authTabIn").onclick = () => setMode("in");
  $("authTabUp").onclick = () => setMode("up");
  if (pendingJoin()) setMode("up");

  const authErr = e => ({
    "auth/invalid-email": "Email 格式不正確。",
    "auth/missing-password": "請輸入密碼。",
    "auth/weak-password": "密碼至少要 6 個字元。",
    "auth/email-already-in-use": "這個 Email 已經註冊過了，請改用「登入」。",
    "auth/invalid-credential": "Email 或密碼不正確。",
    "auth/wrong-password": "Email 或密碼不正確。",
    "auth/user-not-found": "找不到這個帳號，請先「建立帳號」。",
    "auth/too-many-requests": "嘗試太多次了，請稍等幾分鐘再試。",
    "auth/network-request-failed": "連不上網路，請檢查連線。",
    "auth/operation-not-allowed": "Firebase 還沒開啟「電子郵件/密碼」登入方式，請照安裝說明第 3 步設定。",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "config.js 裡的 Firebase 設定不正確，請重新複製貼上。"
  }[e && e.code] || "發生錯誤：" + ((e && e.code) || "請稍後再試"));

  $("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("aEmail").value.trim(), pass = $("aPass").value, name = $("aName").value.trim();
    $("aMsg").className = "msg";
    if (mode === "up" && !name) { $("aMsg").textContent = "請輸入你的稱呼，家人會看到這個名字。"; return; }
    $("aSubmit").disabled = true; $("aMsg").textContent = "";
    try {
      if (mode === "in") await A.signInWithEmailAndPassword(auth, email, pass);
      else {
        pendingName = name;
        const cred = await A.createUserWithEmailAndPassword(auth, email, pass);
        await A.updateProfile(cred.user, { displayName: name });
      }
    } catch (err) { $("aMsg").textContent = authErr(err); }
    finally { $("aSubmit").disabled = false; }
  });
  $("aReset").onclick = async () => {
    const email = $("aEmail").value.trim();
    if (!email) { $("aMsg").className = "msg"; $("aMsg").textContent = "先在上面輸入你的 Email，再按「忘記密碼」。"; return; }
    try { await A.sendPasswordResetEmail(auth, email); $("aMsg").className = "msg ok"; $("aMsg").textContent = "已寄出重設密碼信，請到信箱收信（也看一下垃圾郵件）。"; }
    catch (err) { $("aMsg").className = "msg"; $("aMsg").textContent = authErr(err); }
  };

  /* 家庭設定畫面 */
  const genCode = () => { const a = new Uint32Array(20); crypto.getRandomValues(a); return Array.from(a, n => CODE_CHARS[n % CODE_CHARS.length]).join(""); };
  const normCode = s => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

  $("createForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("cName").value.trim();
    if (!name) { $("cMsg").textContent = "請幫家庭取個名字。"; return; }
    $("cMsg").textContent = "";
    const fid = genCode();
    try {
      await S.setDoc(S.doc(db, "families", fid), { name, members: [me.uid], memberNames: { [me.uid]: me.name }, people: DEFAULT_PEOPLE, createdAt: S.serverTimestamp() });
      await S.setDoc(S.doc(db, "users", me.uid), { familyId: fid });
      startFamily(fid);
    } catch (err) {
      $("cMsg").textContent = err.code === "permission-denied" ? "沒有權限建立。請確認已照安裝說明第 4 步發布 Firestore 安全規則。" : "建立失敗，請檢查網路後再試。";
    }
  });
  $("joinForm").addEventListener("submit", async e => {
    e.preventDefault();
    const code = normCode($("jCode").value);
    if (code.length < 10) { $("jMsg").textContent = "邀請碼不完整，請完整複製家人傳來的邀請碼。"; return; }
    $("jMsg").textContent = "加入中…"; $("jMsg").className = "msg ok";
    try {
      const ref = S.doc(db, "families", code);
      await S.updateDoc(ref, { members: S.arrayUnion(me.uid) });
      await S.updateDoc(ref, { ["memberNames." + me.uid]: me.name });
      await S.setDoc(S.doc(db, "users", me.uid), { familyId: code });
      try { sessionStorage.removeItem("fam-join"); } catch (_) {}
      startFamily(code);
    } catch (err) {
      $("jMsg").className = "msg";
      $("jMsg").textContent = (err.code === "permission-denied" || err.code === "not-found") ? "找不到這個家庭，請確認邀請碼是否正確。" : "加入失敗，請檢查網路後再試。";
    }
  });
  const logout = () => { stopAll(); A.signOut(auth); };
  $("fLogout").onclick = logout;
  $("logoutBtn").onclick = logout;

  /* 進入家庭 */
  function startFamily(fid) {
    stopAll();
    famId = fid; events = []; txns = [];
    const famRef = S.doc(db, "families", fid);
    let first = true;
    store = {
      add: (col, data) => S.addDoc(S.collection(famRef, col), { ...data, createdBy: me.uid }),
      remove: (col, id) => S.deleteDoc(S.doc(famRef, col, id)),
      setPeople: list => S.updateDoc(famRef, { people: list }),
      async importItems(es, ts) {
        const all = [...es.map(x => ["events", x]), ...ts.map(x => ["txns", x])];
        for (let i = 0; i < all.length; i += 400) {
          const batch = S.writeBatch(db);
          all.slice(i, i + 400).forEach(([col, x]) => batch.set(S.doc(S.collection(famRef, col)), { ...x, createdBy: me.uid }));
          await batch.commit();
        }
      }
    };
    unsubs.push(S.onSnapshot(famRef, snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      famName = d.name || ""; people = Array.isArray(d.people) && d.people.length ? d.people : DEFAULT_PEOPLE.slice();
      memberCount = (d.members || []).length; memberNames = d.memberNames || {};
      if (first) {
        first = false;
        $("whoami").textContent = `${me.name}，你好`;
        $("acctEmail").textContent = me.email;
        $("inviteSec").hidden = false; $("accountSec").hidden = false;
        show("App"); notice("");
        if (memberNames[me.uid] !== me.name) S.updateDoc(famRef, { ["memberNames." + me.uid]: me.name }).catch(() => {});
      }
      render();
    }, err => {
      stopAll();
      show("Family");
      $("jMsg").className = "msg";
      $("jMsg").textContent = err.code === "permission-denied" ? "你目前不在任何家庭裡，請加入或建立一個。" : "連線發生問題，請重新開啟 App。";
    }));
    const listen = (col, set) => unsubs.push(S.onSnapshot(S.collection(famRef, col), snap => {
      set(snap.docs.map(d => ({ id: d.id, ...d.data() }))); render();
    }, err => { if (err.code !== "permission-denied") notice("同步中斷，請重新開啟 App。"); }));
    listen("events", v => events = v);
    listen("txns", v => txns = v);
  }

  A.onAuthStateChanged(auth, async user => {
    stopAll();
    if (!user) { famId = ""; show("Auth"); return; }
    me = { uid: user.uid, email: user.email || "", name: user.displayName || pendingName || (user.email || "").split("@")[0] };
    show("Loading");
    try {
      const u = await S.getDoc(S.doc(db, "users", user.uid));
      const fid = u.exists() && u.data().familyId;
      if (fid) { startFamily(fid); return; }
    } catch (_) {}
    show("Family");
    $("jMsg").textContent = "";
    const pj = pendingJoin();
    if (pj) { $("jCode").value = pj; $("jMsg").className = "msg ok"; $("jMsg").textContent = "已帶入邀請碼，按「加入家庭」即可。"; }
  });
}

/* ---------- 啟動 ---------- */
wireApp();
const cfg = window.FIREBASE_CONFIG || {};
if (cfg.apiKey && cfg.projectId) startFirebase(cfg);
else startDemo();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
})();
