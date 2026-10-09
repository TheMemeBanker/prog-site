/* OTC PROG — the rewards desk for smart launches. No backend, no signing.
   Figures come from ./data/live.json (a scheduled snapshot of the public
   otcdesks.cash feeds). Per-coin lookups try the live feed first and fall
   back to the snapshot. */

const $ = (id) => document.getElementById(id);
const SPLIT = { holders: 0.675, desks: 0.10, burn: 0.10, protocol: 0.125 };
const OTC_MINT = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
const FEED = "https://otcdesks.cash/api/rewards";
const PROG_MINT = "BrYs9BT3dRViUa62bwmoDixZcqxyVesFG7fHSXNRpump"; // set on explicit operator link, after on-chain verification
const LIVE = false; // flip to true once otcdesks.cash sends Access-Control-Allow-Origin on /api — until then the live call is blocked by the browser

let D = null;           // snapshot
let solUsd = null;      // live SOL price (DexScreener)
let range = 14;

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmtSol = (n) => n === 0 ? "0" : n >= 1000 ? nf0.format(Math.round(n)) : n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(4);
const fmtUsd = (n) => "$" + (n >= 1000 ? nf0.format(Math.round(n)) : n.toFixed(2));
const fmtInt = (n) => nf0.format(n);
const fmtCompact = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : nf0.format(n);
const fmtAmt = (n) => n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
const ago = (ts) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const utc = (ts) => new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function price(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(8000) });
    const pairs = (await res.json()).filter((p) => (p.volume?.h24 ?? 0) >= 100);
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    return pairs.length ? Number(pairs[0].priceUsd) : null;
  } catch { return null; }
}

/* ---------- hero ---------- */
function renderHero() {
  const r = D.rewards, s = D.stats;
  $("stDist").textContent = fmtSol(r.distributed);
  $("stDistUsd").textContent = solUsd ? `${fmtUsd(r.distributed * solUsd)} at today's SOL · from claimed creator fees` : "from claimed creator fees";
  $("stOwed").textContent = r.owed > 0 ? `${fmtSol(r.owed)} SOL claimed and queued for the next run` : "";
  $("stPaying").textContent = fmtInt(r.paying);
  $("stCoins").textContent = `of ${fmtInt(s.coins)} launched`;
  $("stHolders").textContent = fmtCompact(r.holders_paid);
  $("stAssets").textContent = `across ${fmtInt(r.assets)} reward assets`;
  $("stBurned").textContent = fmtCompact(s.burned_otc);
  $("stBurns").textContent = `${fmtInt(s.burns)} buyback burns`;
  $("stLast").textContent = r.last_distributed_at ? ago(r.last_distributed_at) : "—";
  $("stLast").title = r.last_distributed_at ? utc(r.last_distributed_at) : "";
  $("footSync").textContent = utc(D.at);
  const tot = s.earned || 1;
  $("splitLive").textContent = `${fmtSol(s.earned)} SOL claimed → holders ${fmtSol(r.distributed)} (${(r.distributed / tot * 100).toFixed(1)}%), desks ${fmtSol(s.to_pot)}, buyback ${fmtSol(s.to_buyback)}, protocol ${fmtSol(s.to_protocol)}`;
}

/* ---------- chart: SOL paid to holders per day (single series) ---------- */
function chartData() {
  const d = D.stats.daily.slice();
  const today = new Date().toISOString().slice(0, 10);
  const rows = d.filter((x) => x.day !== today); // today is partial — keep it out of the line
  return range ? rows.slice(-range) : rows;
}
function renderChart() {
  const rows = chartData();
  const host = $("chart");
  host.innerHTML = "";
  const W = host.clientWidth || 800, H = 220, pad = { l: 46, r: 14, t: 14, b: 26 };
  const xs = rows.map((_, i) => pad.l + (i / Math.max(1, rows.length - 1)) * (W - pad.l - pad.r));
  const max = Math.max(1, ...rows.map((r) => r.distributed));
  const nice = niceMax(max);
  const y = (v) => pad.t + (1 - v / nice) * (H - pad.t - pad.b);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", "100%"); svg.setAttribute("height", H);
  // grid + y labels (3 lines)
  for (let i = 0; i <= 4; i++) {
    const v = nice * i / 4, yy = y(v);
    const g = line(ns, pad.l, yy, W - pad.r, yy, "pg-grid"); svg.appendChild(g);
    const t = text(ns, pad.l - 8, yy + 4, fmtSol(v), "pg-axis", "end"); svg.appendChild(t);
  }
  // x labels: first, middle, last
  const idx = rows.length > 2 ? [0, Math.floor((rows.length - 1) / 2), rows.length - 1] : rows.map((_, i) => i);
  idx.forEach((i, k) => svg.appendChild(text(ns, xs[i], H - 8, rows[i].day.slice(5), "pg-axis", k === 0 ? "start" : k === idx.length - 1 ? "end" : "middle")));
  // area + line
  const pts = rows.map((r, i) => `${xs[i].toFixed(1)},${y(r.distributed).toFixed(1)}`);
  const area = document.createElementNS(ns, "path");
  area.setAttribute("d", `M${xs[0]},${y(0)} L${pts.join(" L")} L${xs[xs.length - 1]},${y(0)} Z`); area.setAttribute("class", "pg-area"); svg.appendChild(area);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M" + pts.join(" L")); path.setAttribute("class", "pg-line"); svg.appendChild(path);
  // last point marker + direct label
  const li = rows.length - 1;
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", xs[li]); dot.setAttribute("cy", y(rows[li].distributed)); dot.setAttribute("r", 4); dot.setAttribute("class", "pg-dot"); svg.appendChild(dot);
  // hover layer
  const hover = line(ns, 0, pad.t, 0, H - pad.b, "pg-cross"); hover.setAttribute("visibility", "hidden"); svg.appendChild(hover);
  const hdot = document.createElementNS(ns, "circle"); hdot.setAttribute("r", 5); hdot.setAttribute("class", "pg-dot"); hdot.setAttribute("visibility", "hidden"); svg.appendChild(hdot);
  const tip = $("chartTip");
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    const sx = px * (W / rect.width);
    let i = 0, best = Infinity;
    xs.forEach((x, k) => { const d = Math.abs(x - sx); if (d < best) { best = d; i = k; } });
    hover.setAttribute("x1", xs[i]); hover.setAttribute("x2", xs[i]); hover.setAttribute("visibility", "visible");
    hdot.setAttribute("cx", xs[i]); hdot.setAttribute("cy", y(rows[i].distributed)); hdot.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${rows[i].day}</b><span>${fmtSol(rows[i].distributed)} SOL to holders</span><span>${fmtInt(rows[i].claims)} claims · ${fmtSol(rows[i].earned)} SOL claimed</span>`;
    tip.hidden = false;
    const tx = Math.min(Math.max(8, xs[i] * (rect.width / W) - 80), rect.width - 168);
    tip.style.left = tx + "px";
  };
  const leave = () => { hover.setAttribute("visibility", "hidden"); hdot.setAttribute("visibility", "hidden"); tip.hidden = true; };
  svg.addEventListener("mousemove", move); svg.addEventListener("touchstart", move, { passive: true }); svg.addEventListener("touchmove", move, { passive: true });
  svg.addEventListener("mouseleave", leave); svg.addEventListener("touchend", leave);
  host.appendChild(svg);
  const sum = rows.reduce((a, r) => a + r.distributed, 0);
  $("chartSum").textContent = `${fmtSol(sum)} SOL over ${rows.length} days`;
  // table view
  $("chartTable").innerHTML = `<thead><tr><th>Day</th><th class="num">Claims</th><th class="num">Claimed, SOL</th><th class="num">To holders, SOL</th></tr></thead><tbody>` +
    rows.slice().reverse().map((r) => `<tr><td>${r.day}</td><td class="num">${fmtInt(r.claims)}</td><td class="num">${fmtSol(r.earned)}</td><td class="num">${fmtSol(r.distributed)}</td></tr>`).join("") + "</tbody>";
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10; return n * p; }
function line(ns, x1, y1, x2, y2, cls) { const l = document.createElementNS(ns, "line"); l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2); l.setAttribute("class", cls); return l; }
function text(ns, x, y, s, cls, anchor) { const t = document.createElementNS(ns, "text"); t.setAttribute("x", x); t.setAttribute("y", y); t.setAttribute("class", cls); t.setAttribute("text-anchor", anchor); t.textContent = s; return t; }

/* ---------- lists ---------- */
function tapeRow(x) {
  return `<li><span class="pg-tape-when" title="${utc(x.at)}">${ago(x.at)}</span><span class="pg-tape-coin"><b>${esc(x.symbol)}</b> paid ${fmtAmt(x.amount)} <b>${esc(x.asset)}</b></span><span class="pg-tape-usd">${fmtUsd(x.usd)}</span><span class="pg-tape-h">${fmtInt(x.holders)} holders</span><a class="pg-tape-tx" href="https://solscan.io/tx/${esc(x.sig)}" target="_blank" rel="noopener" aria-label="transaction">tx ↗</a></li>`;
}
function renderLists() {
  $("tape").innerHTML = D.recent.slice(0, 12).map(tapeRow).join("");
  const maxA = Math.max(1, ...D.by_asset.map((a) => a.distributed));
  $("assets").innerHTML = D.by_asset.slice(0, 10).map((a) => `<li><span class="pg-asset-sym">${esc(a.symbol)}</span><span class="pg-asset-bar"><i style="width:${(a.distributed / maxA * 100).toFixed(1)}%"></i></span><span class="pg-asset-n">${fmtSol(a.distributed)} SOL</span><span class="pg-asset-c">${fmtInt(a.coins)} coins</span></li>`).join("");
  $("topTable").querySelector("tbody").innerHTML = D.top.slice(0, 12).map((t) => `<tr><td><a href="#lookup" data-mint="${esc(t.mint)}" class="pg-coinlink"><b>${esc(t.symbol)}</b> <span class="pg-note">${esc(t.name)}</span></a></td><td>${esc(t.reward)}</td><td class="num">${fmtSol(t.distributed)} SOL</td><td class="num">${fmtInt(t.holders_paid)}</td><td class="num">${t.mcap ? fmtUsd(t.mcap) : "—"}</td></tr>`).join("");
  $("newCoins").innerHTML = D.new_coins.slice(0, 8).map((c) => `<li><a href="#lookup" data-mint="${esc(c.mint)}" class="pg-coinlink"><b>${esc(c.symbol)}</b> <span class="pg-note">${esc(c.name)}</span></a><span class="pg-new-pays">pays <b>${esc(c.reward)}</b>${c.basket > 1 ? ` · basket of ${c.basket}` : ""}</span><span class="pg-tape-when" title="${utc(c.created)}">${ago(c.created)}</span></li>`).join("");
  document.querySelectorAll(".pg-coinlink").forEach((a) => a.addEventListener("click", () => { $("q").value = a.dataset.mint; lookup(); }));
  // simulator asset list
  const sel = $("simAsset");
  sel.innerHTML = D.by_asset.slice(0, 12).map((a) => `<option value="${esc(a.symbol)}">${esc(a.symbol)}</option>`).join("") + `<option value="a basket">a basket</option>`;
}

/* ---------- simulator ---------- */
function sim() {
  const fee = Math.max(0, Number($("simFee").value) || 0);
  const share = Math.min(100, Math.max(0, Number($("simShare").value) || 0)) / 100;
  const asset = $("simAsset").value || "the reward asset";
  const h = fee * SPLIT.holders, d = fee * SPLIT.desks, b = fee * SPLIT.burn, p = fee * SPLIT.protocol;
  $("simHolders").textContent = fmtSol(h) + " SOL";
  $("simHoldersAsset").textContent = `bought as ${asset}${solUsd ? ` · ${fmtUsd(h * solUsd)}` : ""}`;
  $("simDesks").textContent = fmtSol(d) + " SOL";
  $("simBurn").textContent = fmtSol(b) + " SOL";
  $("simBurnOtc").textContent = D.otc?.usd && solUsd ? `≈ ${fmtCompact(b * solUsd / D.otc.usd)} OTC at today's price` : "";
  $("simProto").textContent = fmtSol(p) + " SOL";
  const you = h * share;
  $("simYou").textContent = fmtSol(you) + " SOL";
  $("simYouNote").textContent = `of ${asset}, for holding ${(share * 100).toFixed(2)}% of supply${solUsd ? ` · ${fmtUsd(you * solUsd)}` : ""}`;
}

/* ---------- lookup ---------- */
function looksLikeMint(s) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); }
function findInSnapshot(q) {
  const ql = q.toLowerCase();
  const pools = [...D.top.map((t) => ({ ...t, src: "top" })), ...D.new_coins.map((c) => ({ ...c, src: "new" }))];
  let hit = pools.find((c) => c.mint === q) || pools.find((c) => (c.symbol || "").toLowerCase() === ql);
  if (!hit) {
    const rec = D.recent.find((x) => x.mint === q || (x.symbol || "").toLowerCase() === ql);
    if (rec) hit = { mint: rec.mint, symbol: rec.symbol, name: rec.name, reward: rec.asset, src: "recent" };
  }
  return hit;
}
async function liveCoin(mint) {
  const res = await fetch(`${FEED}?mint=${mint}`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error("feed");
  return res.json();
}
async function lookup() {
  const q = $("q").value.trim();
  $("lookupErr").hidden = true; $("lookupOut").hidden = true;
  if (!q) return;
  $("go").disabled = true; $("go").textContent = "Reading…";
  try {
    let coin = findInSnapshot(q);
    let live = null;
    const mint = coin?.mint || (looksLikeMint(q) ? q : null);
    if (mint && LIVE) { try { live = await liveCoin(mint); } catch { live = null; } }
    const recent = live ? live.recent.filter((x) => x.mint === mint).map((x) => ({ at: x.at, symbol: x.symbol, name: x.name, mint: x.mint, asset: x.assetSymbol, amount: x.amount / 10 ** (x.decimals || 0), usd: x.usd || 0, holders: x.holders || 0, sig: x.signature }))
                         : D.recent.filter((x) => x.mint === mint);
    if (!coin && recent.length) coin = { mint, symbol: recent[0].symbol, name: recent[0].name, reward: recent[0].asset, src: "live" };
    if (!coin) {
      $("lookupErr").innerHTML = looksLikeMint(q)
        ? `No program found for that mint in the current feeds. If it was launched on OTC, find it on <a href="https://otcdesks.cash/explore" target="_blank" rel="noopener">otcdesks.cash/explore</a>.`
        : `No coin by that ticker in the current snapshot — paste its mint address instead, or find it on <a href="https://otcdesks.cash/explore" target="_blank" rel="noopener">otcdesks.cash/explore</a>.`;
      $("lookupErr").hidden = false;
      return;
    }
    $("cSym").textContent = coin.symbol || mint.slice(0, 6) + "…";
    $("cName").textContent = coin.name || "";
    $("cSolscan").href = `https://solscan.io/token/${coin.mint}`;
    $("cExplore").href = `https://otcdesks.cash/coin/${coin.mint}`;
    $("cAsset").textContent = coin.reward || recent[0]?.asset || "—";
    $("cDist").textContent = coin.distributed != null ? fmtSol(coin.distributed) + " SOL" : recent.length ? `${fmtUsd(recent.reduce((a, x) => a + x.usd, 0))} in the latest ${recent.length}` : "—";
    $("cPays").textContent = live?.payoutsKnown != null ? fmtInt(live.payoutsKnown) : coin.holders_paid != null ? fmtInt(coin.holders_paid) : "—";
    const last = live?.lastPaidAt || recent[0]?.at;
    $("cLast").textContent = last ? ago(last) : "—"; $("cLast").title = last ? utc(last) : "";
    $("cTape").innerHTML = recent.slice(0, 8).map(tapeRow).join("");
    $("cNote").textContent = live
      ? `Read live from the OTC rewards feed${live.recordsFrom ? `, records since ${utc(live.recordsFrom).slice(0, 10)}` : ""}.`
      : coin.src === "new" ? "Just launched — its first payouts will appear here once its fees are claimed. Figures from the snapshot; the live feed opens when otcdesks.cash allows cross-site reads."
      : "Figures from the latest snapshot. The live per-coin feed opens when otcdesks.cash allows cross-site reads.";
    $("lookupOut").hidden = false;
  } catch {
    $("lookupErr").textContent = "Could not read that coin right now — try again in a moment.";
    $("lookupErr").hidden = false;
  } finally {
    $("go").disabled = false; $("go").textContent = "Look up";
  }
}

/* ---------- boot ---------- */
async function boot() {
  const [snap, sol] = await Promise.all([fetch("./data/live.json", { cache: "no-cache" }).then((r) => r.json()), price("So11111111111111111111111111111111111111112")]);
  D = snap; solUsd = sol;
  renderHero(); renderChart(); renderLists(); sim();
  if (PROG_MINT) {
    const a = document.createElement("a"); a.href = `https://solscan.io/token/${PROG_MINT}`; a.target = "_blank"; a.rel = "noopener"; a.textContent = PROG_MINT;
    $("progMint").replaceChildren(a);
    const pill = $("progTokenLink"); pill.href = `https://pump.fun/coin/${PROG_MINT}`; pill.removeAttribute("aria-disabled"); pill.removeAttribute("title"); pill.target = "_blank"; pill.rel = "noopener";
    const buy = $("progBuy"); if (buy) { buy.href = `https://pump.fun/coin/${PROG_MINT}`; buy.hidden = false; }
  }
  setInterval(() => { $("stLast").textContent = D.rewards.last_distributed_at ? ago(D.rewards.last_distributed_at) : "—"; document.querySelectorAll(".pg-tape-when").forEach((el) => { const t = el.title ? Date.parse(el.title.replace(" UTC", "Z").replace(" ", "T")) / 1000 : null; if (t) el.textContent = ago(t); }); }, 30000);
}
boot().catch(() => { $("stDist").textContent = "verify ↗"; });

$("go").addEventListener("click", lookup);
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });
["simFee", "simShare", "simAsset"].forEach((id) => $(id).addEventListener("input", sim));
document.querySelectorAll(".pg-chip").forEach((b) => b.addEventListener("click", () => { document.querySelectorAll(".pg-chip").forEach((x) => x.classList.toggle("is-on", x === b)); range = Number(b.dataset.days); renderChart(); }));
let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => D && renderChart(), 150); });
$("themeBtn").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", cur);
  try { localStorage.setItem("prog-theme", cur); } catch { }
  if (D) renderChart();
});

// sidebar drawer (mobile)
const side = $("sidebar"), scrim = $("sideScrim");
$("sideToggle").addEventListener("click", () => { const open = side.classList.toggle("open"); scrim.hidden = !open; });
scrim.addEventListener("click", () => { side.classList.remove("open"); scrim.hidden = true; });
