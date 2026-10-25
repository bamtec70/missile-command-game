/* Missile Command tribute - build 1. Hand-made pixel graphics, Web Audio synthesized sound. No ROM/MAME data. */
(() => {
"use strict";
const W = 256, H = 228, GROUND = 212, STEP = 1000 / 60;
const DEBUG = /[?&]debug/.test(location.search);
const view = document.getElementById("game"), vctx = view.getContext("2d");
const buf = document.createElement("canvas"); buf.width = W; buf.height = H;
const g = buf.getContext("2d");
const FONT = window.MCFONT;
const rnd = (a, b) => a + Math.random() * (b - a), irnd = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Palette (pure primaries/secondaries only) ---------- */
const C = { k: "#000", r: "#f00", g: "#0f0", b: "#00f", y: "#ff0", m: "#f0f", c: "#0ff", w: "#fff" };
const PALS = [ // bg, ground, enemy trail(s), city (a,b), player trail
 { bg: C.k, gr: C.y, en: [C.r], city: [C.b, C.c], pl: C.b },
 { bg: C.k, gr: C.y, en: [C.g], city: [C.b, C.c], pl: C.b },
 { bg: C.k, gr: C.b, en: [C.g, C.m], city: [C.y, C.g], pl: C.y },
 { bg: C.k, gr: C.r, en: [C.y], city: [C.c, C.b], pl: C.g },
 { bg: C.b, gr: C.y, en: [C.r, C.m], city: [C.m, C.r], pl: C.c },
];
const ATTRACT_PAL = { bg: C.k, gr: C.r, en: [C.r], city: [C.b, C.c], pl: C.b };
const palFor = w => PALS[Math.floor((w - 1) / 2) % 5];
const EXCOL = [C.w, C.y, C.m, C.b, C.r, C.c, C.g];

/* ---------- Audio ---------- */
let AC = null, master = null;
localStorage.removeItem("mc_muted");
let muted = localStorage.getItem("mc_muted_v1") === "1";
function audio() {
 if (!AC) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; AC = new A(); master = AC.createGain(); master.connect(AC.destination); }
 master.gain.value = muted ? 0 : 0.5;
 if (AC.state !== "running" && AC.resume) AC.resume().catch(() => {});
 return AC;
}
let noiseBuf = null;
function getNoise() { if (!noiseBuf) { noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return noiseBuf; }
const silent = () => !AC || state === "attract" || state === "table";
function tone(type, f0, f1, dur, vol, when = 0) {
 if (!AC) return; const t = AC.currentTime + when, o = AC.createOscillator(), v = AC.createGain();
 o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.linearRampToValueAtTime(f1, t + dur);
 v.gain.setValueAtTime(vol, t); v.gain.setValueAtTime(vol, t + dur * 0.8); v.gain.linearRampToValueAtTime(0, t + dur);
 o.connect(v); v.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, lp, hiss = 0) {
 if (!AC) return; const t = AC.currentTime, s = AC.createBufferSource(); s.buffer = getNoise(); s.playbackRate.value = rnd(0.8, 1.2);
 const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; const v = AC.createGain();
 v.gain.setValueAtTime(vol, t); v.gain.exponentialRampToValueAtTime(0.001, t + dur);
 s.connect(f); f.connect(v); v.connect(master);
 if (hiss) { const f2 = AC.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = 1500; f2.Q.value = 0.7; const v2 = AC.createGain(); v2.gain.setValueAtTime(hiss, t); v2.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f2); f2.connect(v2); v2.connect(master); }
 s.start(t, rnd(0, 1)); s.stop(t + dur + 0.05);
}
const sfx = {
 launch() { if (silent()) return; noise(0.1, 0.55, 200, 0.18); },
 boom() { if (silent()) return; noise(rnd(0.55, 0.9), 0.5, 150, 0); noise(0.5, 0.18, 2200); },
 siren() { if (silent()) return; let t = 0; for (let f = 1100; f >= 600; f -= 100) { tone("square", f, f, 0.09, 0.07, t); t += 0.1; } for (let i = 0; i < 6; i++) { tone("square", 490, 490, 0.12, 0.07, t); t += 0.2; } },
 tick(i) { if (silent()) return; const f = Math.min(1000, 500 + i * 30); tone("square", f, f, 0.05, 0.08); },
 bonusCity() { if (silent()) return; tone("square", 970, 970, 1.2, 0.06); },
 low() { if (silent()) return; tone("square", 760, 760, 0.06, 0.06); },
 out() { if (silent()) return; tone("square", 330, 330, 0.08, 0.07); },
 cityLost() { if (silent()) return; tone("square", 220, 200, 0.5, 0.06); tone("triangle", 110, 100, 0.6, 0.1); },
 theEnd() { if (silent()) return; for (let i = 0; i < 4; i++) { tone("square", 220, 180, 0.4, 0.07, i * 0.45); noise(0.8, 0.4, 140); } },
};

/* ---------- Layout ---------- */
const BASES_X = [20, 128, 236], CITIES_X = [47, 74, 101, 155, 182, 209];
const CURSOR_MIN_Y = 14, CURSOR_MAX_Y = GROUND - 45;
const HILL = []; // ground height profile (y of top surface per column)
(function makeGround() {
 for (let x = 0; x < W; x++) {
  let y = GROUND;
  for (const bx of BASES_X) { const d = Math.abs(x - bx); if (d < 16) y = Math.min(y, GROUND - 9 + Math.max(0, d - 8)); }
  for (const cx of CITIES_X) { const d = Math.abs(x - cx); if (d < 9) y = Math.min(y, GROUND - 2); }
  if (y === GROUND && (x * 7) % 13 === 0) y = GROUND - 1;
  HILL.push(y);
 }
})();
const BASE_TOP = bx => GROUND - 9;
const CITY_SPRITE = [ // 13x7, 1=a color, 2=b color, hand-drawn skyline
 "....1........",
 "...111..2....",
 ".1.111.222.1.",
 ".11121.222.11",
 "1112211221111",
 "1212112212121",
 "2222222222222"];
const RUBBLE = ["..1..1...1...", ".121.11.121.1", "1222122122211"];
const BOMBER = [ "1......1.", "11....111", ".1111111.", "..11111..", "...1.1..." ];
const SATELLITE = [ "1.1.1", ".111.", "11211", ".111.", "1.1.1" ];

/* ---------- State ---------- */
let state = "attract", stateT = 0, attractPhase = 0, frame = 0;
let score = 0, wave = 1, mult = 1, pal = ATTRACT_PAL, nextBonus = 10000, bonusStock = 0;
let cities, bases, pmis, emis, fliers, booms, enemyLeft, salvoT, flierT, bombsLeft, bonusInfo, endT, demo = false;
const cursor = { x: 128, y: 100 };
let invuln = false, holdWave = false;

const TABLE_KEY = "mc_table_v1";
const DEFAULT_TABLE = [[7500, "WTP"], [7250, "BAM"], [7000, "ARC"], [6750, "MCD"], [6500, "CMD"], [6250, "DEF"], [6000, "SKY"], [5750, "ABM"], [5500, "ICB"], [5250, "XYZ"]];
let table; try { table = JSON.parse(localStorage.getItem(TABLE_KEY)); } catch (_) {}
if (!Array.isArray(table) || table.length !== 10) table = DEFAULT_TABLE.map(e => e.slice());
let high = table[0][0];
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ ";
let entry = null;

function resetField() {
 cities = CITIES_X.map(x => ({ x, alive: true }));
 bases = BASES_X.map((x, i) => ({ x, i, ammo: 10, alive: true }));
 pmis = []; emis = []; fliers = []; booms = [];
}
function waveConfig(w) {
 return {
  count: Math.min(20, Math.round(12 + (w - 1) * 2.5)),
  speed: Math.min(0.9, 0.18 + 0.08 * (w - 1)), // units per 1/60s frame
  mirv: w >= 2 ? Math.min(0.45, 0.12 + 0.05 * (w - 2)) : 0,
  fliers: w >= 2,
  smart: w >= 6 ? Math.min(6, w - 5) : 0,
 };
}
let cfg = waveConfig(1);
function startGame() {
 holdWave = false; demo = false; score = 0; wave = 1; nextBonus = 10000; bonusStock = 0; resetField(); beginWave();
}
function beginWave() {
 cfg = waveConfig(wave); mult = Math.min(6, Math.ceil(wave / 2)); pal = palFor(wave);
 for (const b of bases) { b.ammo = 10; b.alive = true; }
 pmis = []; emis = []; fliers = []; booms = [];
 enemyLeft = cfg.count; bombsLeft = cfg.smart; salvoT = 60; flierT = irnd(300, 600);
 setState("banner"); sfx.siren();
}
function setState(s) { state = s; stateT = 0; }

/* ---------- Spawning ---------- */
function targets() {
 const t = [];
 for (const c of cities) if (c.alive) t.push({ x: c.x, y: GROUND - 3, kind: "city", ref: c });
 for (const b of bases) t.push({ x: b.x, y: BASE_TOP(b.x), kind: "base", ref: b });
 return t;
}
function pickTarget(avoid) {
 const t = targets(); let pool = t.filter(o => !avoid || !avoid.includes(o.ref)); if (!pool.length) pool = t;
 return pool[irnd(0, pool.length - 1)];
}
function spawnEnemy(x, y, tgt, kind = "missile") {
 const t = tgt || pickTarget();
 const dx = t.x - x, dy = t.y - y, d = Math.hypot(dx, dy) || 1;
 const sp = kind === "smart" ? Math.max(0.5, cfg.speed) : cfg.speed;
 const m = { sx: x, sy: y, x, y, vx: dx / d * sp, vy: dy / d * sp, tgt: t, kind, alive: true, col: pal.en[irnd(0, pal.en.length - 1)],
  splitY: kind === "missile" && Math.random() < cfg.mirv ? rnd(H / 3, H * 2 / 3) : -1 };
 emis.push(m); return m;
}
function spawnSalvo() {
 const live = emis.filter(m => m.alive).length;
 let n = Math.min(irnd(3, 4), enemyLeft, 8 - live);
 for (let i = 0; i < n; i++) { spawnEnemy(rnd(4, W - 4), 8); enemyLeft--; }
 if (bombsLeft > 0 && live + n < 8 && Math.random() < 0.5) { spawnEnemy(rnd(30, W - 30), 8, null, "smart"); bombsLeft--; }
}
function spawnFlier(kind) {
 const dir = Math.random() < 0.5 ? 1 : -1, k = kind || (wave >= 4 && Math.random() < 0.4 ? "sat" : "bomber");
 fliers.push({ kind: k, x: dir > 0 ? -10 : W + 10, y: GROUND - rnd(100, 140), vx: dir * (k === "sat" ? 0.55 : 0.45), drops: irnd(1, 3), dropT: irnd(60, 160), alive: true });
}

/* ---------- Player fire ---------- */
const BASE_SPEED = [2.6, 5.5, 2.6];
function fire(i, tx = cursor.x, ty = cursor.y) {
 if (!(state === "play" || (state === "attract" && demo))) return false;
 const b = bases[i]; if (!b || !b.alive || b.ammo <= 0) { if (b && b.ammo <= 0) sfx.out(); return false; }
 if (pmis.filter(p => p.alive).length >= 8) return false;
 ty = clamp(ty, CURSOR_MIN_Y, CURSOR_MAX_Y); tx = clamp(tx, 8, 247);
 const sx = b.x, sy = BASE_TOP(b.x) - 1, dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy) || 1, sp = BASE_SPEED[i];
 pmis.push({ sx, sy, x: sx, y: sy, tx, ty, vx: dx / d * sp, vy: dy / d * sp, left: d / sp, alive: true });
 b.ammo--; sfx.launch(); if (b.ammo === 3) sfx.low(); if (b.ammo === 0) sfx.out();
 return true;
}
function nearestBase(tx) {
 let best = -1, bd = 1e9;
 for (const b of bases) if (b.alive && b.ammo > 0) { const d = Math.abs(b.x - tx); if (d < bd) { bd = d; best = b.i; } }
 return best;
}
function fireNearest(tx, ty) { const i = nearestBase(tx); if (i >= 0) return fire(i, tx, ty); sfx.out(); return false; }

/* ---------- Explosions ---------- */
function boom(x, y, src) { booms.push({ x, y, f: 0, src }); if (src !== "silent") sfx.boom(); }
// radius over life: 4.5 -> 13.5 growing 1px/5 frames, hold 10f, shrink to 3.5
const GROW = 45, HOLD = 10, SHRINK = 50, LIFE = GROW + HOLD + SHRINK;
function boomR(f) { return f < GROW ? 4.5 + f / 5 : f < GROW + HOLD ? 13.5 : 13.5 - (f - GROW - HOLD) / 5; }

/* ---------- Scoring ---------- */
function addScore(p) {
 if (demo || state === "attract") return;
 score += p * mult; if (score > high) high = score;
 while (score >= nextBonus) { bonusStock++; nextBonus += 10000; }
}

/* ---------- Update ---------- */
function hitByBoom(x, y, pad = 0) { for (const b of booms) if (b.f > 0 && Math.hypot(b.x - x, b.y - y) < boomR(b.f) + pad) return b; return null; }
function destroyEnemy(m, pts) { m.alive = false; boom(m.x, m.y); addScore(pts); }
function impact(m) {
 m.alive = false; boom(m.x, m.y);
 const t = m.tgt;
 if (t.kind === "city" && t.ref.alive) { t.ref.alive = false; sfx.cityLost(); }
 if (t.kind === "base") { t.ref.alive = false; t.ref.ammo = 0; }
 if (invuln) { if (t.kind === "city") t.ref.alive = true; if (t.kind === "base") { t.ref.alive = true; t.ref.ammo = 10; } }
}
function updateField() {
 // player missiles
 for (const p of pmis) if (p.alive) { p.x += p.vx; p.y += p.vy; if (--p.left <= 0) { p.alive = false; boom(p.tx, p.ty, "p"); } }
 pmis = pmis.filter(p => p.alive);
 // explosions
 for (const b of booms) b.f++;
 booms = booms.filter(b => b.f < LIFE);
 // enemies
 for (const m of emis) {
  if (!m.alive) continue;
  if (m.kind === "smart") { // dodge explosions: sidestep perpendicular to the nearest threat
   let dodge = 0; for (const b of booms) { const d = Math.hypot(b.x - m.x, b.y - m.y); if (d < boomR(b.f) + 14 && d > 0) dodge += (m.x < b.x ? -1 : 1); }
   if (dodge) m.x = clamp(m.x + Math.sign(dodge) * 1.1, 4, W - 4);
   const dx = m.tgt.x - m.x, dy = m.tgt.y - m.y, d = Math.hypot(dx, dy) || 1; const sp = Math.hypot(m.vx, m.vy); m.vx = dx / d * sp; m.vy = dy / d * sp;
  }
  m.x += m.vx; m.y += m.vy;
  if (hitByBoom(m.x, m.y, m.kind === "smart" ? -2 : 0)) { destroyEnemy(m, m.kind === "smart" ? 125 : 25); continue; }
  if (m.splitY > 0 && m.y >= m.splitY) { // MIRV
   m.splitY = -1; const n = irnd(2, 3), used = [m.tgt.ref];
   for (let i = 0; i < n && emis.filter(e => e.alive).length < 10; i++) { const t = pickTarget(used); used.push(t.ref); const c = spawnEnemy(m.x, m.y, t); c.sx = m.x; c.sy = m.y; c.splitY = -1; }
  }
  if (m.y >= m.tgt.y) impact(m);
 }
 emis = emis.filter(m => m.alive);
 // fliers
 for (const f of fliers) {
  if (!f.alive) continue; f.x += f.vx;
  if (--f.dropT <= 0 && f.drops > 0 && f.x > 20 && f.x < W - 20) { f.drops--; f.dropT = irnd(80, 180); const n = irnd(1, 2); for (let i = 0; i < n; i++) spawnEnemy(f.x, f.y + 3); }
  if (hitByBoom(f.x, f.y, 3)) { f.alive = false; boom(f.x, f.y); addScore(100); continue; }
  if (f.x < -14 || f.x > W + 14) f.alive = false;
 }
 fliers = fliers.filter(f => f.alive);
}
function demoAI() { // attract demo: shoot at the lowest incoming threat
 if (frame % 22) return;
 const t = emis.filter(m => m.alive && m.y > 30).sort((a, b) => b.y - a.y)[0]; if (!t) return;
 const lead = 40; const tx = t.x + t.vx * lead, ty = t.y + t.vy * lead;
 cursor.x = clamp(tx, 8, 247); cursor.y = clamp(ty, CURSOR_MIN_Y, CURSOR_MAX_Y); fireNearest(cursor.x, cursor.y);
}
function update() {
 frame++; stateT++;
 if (state === "attract") {
  if (stateT === 1) { attractPhase = 0; pal = ATTRACT_PAL; }
  const ph = Math.floor(stateT / 480) % 3; // title / demo / high scores, 8s each
  if (ph !== attractPhase) { attractPhase = ph; if (ph === 1) { demo = true; resetField(); cfg = waveConfig(irnd(1, 4)); pal = palFor(irnd(1, 6)); mult = 1; enemyLeft = 99; bombsLeft = 0; salvoT = 20; flierT = 200; } else { demo = false; pal = ATTRACT_PAL; emis = []; pmis = []; booms = []; fliers = []; } }
  if (demo) { if (--salvoT <= 0) { salvoT = irnd(140, 220); spawnSalvo(); } if (--flierT <= 0) { flierT = irnd(400, 700); spawnFlier(); } demoAI(); updateField(); if (!cities.some(c => c.alive)) resetField(); }
  return;
 }
 if (state === "table") { if (stateT > 420) setState("attract"); return; }
 if (state === "banner") { if (stateT > 120) setState("play"); return; }
 if (state === "play") {
  if (enemyLeft > 0 && --salvoT <= 0) { salvoT = irnd(150, 260); spawnSalvo(); }
  if (cfg.fliers && enemyLeft > 0 && --flierT <= 0) { flierT = irnd(600, 1200); spawnFlier(); }
  updateField();
  const allGone = !cities.some(c => c.alive);
  const clear = !holdWave && enemyLeft <= 0 && bombsLeft <= 0 && !emis.length && !fliers.length && !booms.length && !pmis.length;
  if (allGone && !booms.length && !emis.some(m => m.y > GROUND - 60)) { endT = 0; sfx.theEnd(); setState("theend"); return; }
  if (clear) { startBonus(); }
  return;
 }
 if (state === "bonus") { updateBonus(); return; }
 if (state === "theend") { if (stateT % 20 === 0 && stateT < 140) boom(rnd(40, 216), rnd(70, 170), "silent"); for (const b of booms) b.f++; booms = booms.filter(b => b.f < LIFE); if (stateT > 240) gameOver(); return; }
 if (state === "entry") { entry.t += 1 / 60; return; }
}

/* ---------- End-of-wave bonus ---------- */
function startBonus() {
 const ammo = bases.reduce((s, b) => s + (b.alive ? b.ammo : 0), 0);
 const live = cities.filter(c => c.alive).length;
 bonusInfo = { ammo, ammoN: 0, live, cityN: 0, ammoPts: 0, cityPts: 0, t: 0, phase: 0, bonusCity: false };
 for (const b of bases) if (!b.alive) b.ammo = 0;
 setState("bonus");
}
function updateBonus() {
 const B = bonusInfo; B.t++;
 if (B.phase === 0) { if (B.t > 30) B.phase = 1, B.t = 0; return; }
 if (B.phase === 1) { if (B.t % 5 === 0) { if (B.ammoN < B.ammo) { B.ammoN++; B.ammoPts += 5 * mult; addScore(5); sfx.tick(B.ammoN); } else { B.phase = 2; B.t = 0; } } return; }
 if (B.phase === 2) { if (B.t % 15 === 0 && B.t > 15) { if (B.cityN < B.live) { B.cityN++; B.cityPts += 100 * mult; addScore(100); sfx.tick(B.cityN * 4); } else { B.phase = 3; B.t = 0; } } return; }
 if (B.phase === 3) {
  if (B.t === 1 && bonusStock > 0 && cities.some(c => !c.alive)) { const dead = cities.filter(c => !c.alive); dead[irnd(0, dead.length - 1)].alive = true; bonusStock--; B.bonusCity = true; sfx.bonusCity(); }
  if (B.t > (B.bonusCity ? 150 : 90)) {
   if (!cities.some(c => c.alive)) { sfx.theEnd(); setState("theend"); return; }
   wave++; beginWave();
  }
 }
}

/* ---------- Game over / initials ---------- */
function qualifies(s) { return s > 0 && s > table[9][0]; }
function gameOver() {
 booms = []; emis = []; pmis = []; fliers = [];
 if (qualifies(score)) { keys.clear(); entry = { chars: [0, 26, 26], pos: 0, t: 0 }; setState("entry"); }
 else { setState("table"); }
}
const entryArmed = () => entry && entry.t >= 0.5;
function entryShift(d) { if (!entryArmed()) return; entry.chars[entry.pos] = (entry.chars[entry.pos] + d + ALPHA.length) % ALPHA.length; sfx.tick(2); }
function entryNext() {
 if (!entryArmed()) return; sfx.tick(10); entry.pos++;
 if (entry.pos >= 3) {
  const name = entry.chars.map(i => ALPHA[i]).join("").replace(/ /g, "-");
  table.push([score, name]); table.sort((a, b) => b[0] - a[0]); table = table.slice(0, 10); high = table[0][0];
  localStorage.setItem(TABLE_KEY, JSON.stringify(table)); entry = null; setState("table");
 } else entry.chars[entry.pos] = entry.chars[entry.pos - 1] === 26 ? 0 : 0;
}
function entryLetter(ch) { if (!entryArmed()) return; entry.chars[entry.pos] = ALPHA.indexOf(ch); entryNext(); }

/* ---------- Drawing ---------- */
function px(x, y, c) { g.fillStyle = c; g.fillRect(x | 0, y | 0, 1, 1); }
function text(s, x, y, col, align = "left", scale = 1) {
 s = String(s).toUpperCase(); const w = s.length * 6 * scale - scale;
 if (align === "center") x -= w / 2; else if (align === "right") x -= w;
 x = Math.round(x); g.fillStyle = col;
 for (let i = 0; i < s.length; i++) { const gl = FONT[s[i]] || FONT["?"]; for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (gl[r] & (16 >> c)) g.fillRect(x + (i * 6 + c) * scale, y + r * scale, scale, scale); }
}
function sprite(rows, x, y, cols) { for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) { const ch = rows[r][c]; if (ch !== ".") px(x + c, y + r, cols[+ch - 1] || cols[0]); } }
function line(x0, y0, x1, y1, col) { // pixel trail (Bresenham)
 x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; g.fillStyle = col;
 const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
 for (let n = 0; n < 600; n++) { g.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
}
function disc(x, y, r, col) { g.fillStyle = col; for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) { const w = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy))); if (r * r - dy * dy >= 0) g.fillRect(Math.round(x - w), Math.round(y + dy), w * 2 + 1, 1); } }
function drawGround() {
 g.fillStyle = pal.gr; for (let x = 0; x < W; x++) g.fillRect(x, HILL[x], 1, H - HILL[x]);
}
function drawBases() {
 for (const b of bases) {
  if (!b.alive && state !== "attract") continue;
  const top = BASE_TOP(b.x); const rows = [4, 3, 2, 1]; let k = 0;
  for (let r = 0; r < 4; r++) for (let i = 0; i < rows[3 - r]; i++) { // pyramid: 1,2,3,4 from top
   if (k >= b.ammo) break; const n = rows[3 - r], x = b.x - (n - 1) * 2 + i * 4, y = top + 1 + r * 2;
   g.fillStyle = pal.city[0]; g.fillRect(x, y, 1, 2); g.fillStyle = pal.city[1]; g.fillRect(x - 1, y + 1, 1, 1); g.fillRect(x + 1, y + 1, 1, 1); k++;
  }
  if (state === "play" || state === "banner") { if (b.ammo === 0) text("OUT", b.x, GROUND + 4, pal.gr === C.b ? C.k : C.b, "center"); else if (b.ammo <= 3) text("LOW", b.x, GROUND + 4, pal.gr === C.b ? C.k : C.b, "center"); }
 }
}
function drawCities() { for (const c of cities) sprite(c.alive ? CITY_SPRITE : RUBBLE, c.x - 6, c.alive ? GROUND - 9 : GROUND - 5, c.alive ? pal.city : [pal.gr === C.r ? C.y : C.r, C.k]); }
function drawField() {
 for (const m of emis) { line(m.sx, m.sy, m.x, m.y, m.col); if (m.kind === "smart") { g.fillStyle = C.w; g.fillRect(m.x - 1, m.y - 2, 3, 5); g.fillRect(m.x - 2, m.y - 1, 5, 3); g.fillStyle = pal.en[0]; g.fillRect(m.x, m.y - 1, 1, 3); } else px(m.x, m.y, frame % 4 < 2 ? C.w : m.col); }
 for (const p of pmis) { line(p.sx, p.sy, p.x, p.y, pal.pl); px(p.x, p.y, C.w); const c = EXCOL[(frame >> 2) % 7]; px(p.tx - 1, p.ty - 1, c); px(p.tx + 1, p.ty - 1, c); px(p.tx, p.ty, c); px(p.tx - 1, p.ty + 1, c); px(p.tx + 1, p.ty + 1, c); }
 for (const f of fliers) sprite(f.kind === "sat" ? SATELLITE : BOMBER, f.x - 4, f.y - 2, f.kind === "sat" ? [C.y, C.w] : [C.r]);
 for (const b of booms) { if ((b.f + 3) % 16 < 2) continue; disc(b.x, b.y, boomR(b.f), EXCOL[(b.f >> 2) % 7]); }
}
function drawCursor() { const c = C.b === pal.bg ? C.w : C.b; g.fillStyle = c; g.fillRect(cursor.x - 2, cursor.y, 5, 1); g.fillRect(cursor.x, cursor.y - 2, 1, 5); }
function drawHud() {
 text(String(score), 60, 2, C.r, "right"); g.fillStyle = pal.bg === C.b ? C.y : C.b; g.fillRect(63, 4, 3, 3); // player-1 marker
 text(String(high), 128, 2, C.r, "center");
}
function draw() {
 g.fillStyle = pal.bg; g.fillRect(0, 0, W, H);
 if (state === "attract" && attractPhase === 0) {
  drawGround(); drawCities(); drawHud();
  text("MISSILE", 128, 52, C.r, "center", 3); text("COMMAND", 128, 82, C.r, "center", 3);
  text("DEFEND CITIES", 128, 128, C.b, "center");
  text("PRESS FIRE OR TAP TO START", 128, 150, frame % 60 < 40 ? C.y : C.b, "center");
  text("WTP ARCADE TRIBUTE", 128, H - 8, C.b, "center");
 } else if (state === "table" || (state === "attract" && attractPhase === 2)) {
  pal = ATTRACT_PAL; drawGround(); drawHud();
  text("HIGH SCORES", 128, 22, C.b, "center");
  table.forEach((e, i) => { text(e[1], 84, 36 + i * 10, C.y); text(String(e[0]), 172, 36 + i * 10, C.y, "right"); });
  text("BONUS CITY EVERY", 98, 148, C.b, "center"); text("10000", 172, 148, C.y, "center"); text("POINTS", 208, 148, C.b, "center");
  if (state === "attract") text("PRESS FIRE OR TAP TO START", 128, 170, frame % 60 < 40 ? C.y : C.b, "center");
 } else if (state === "entry") {
  pal = ATTRACT_PAL; drawGround(); drawHud();
  text("PLAYER 1", 128, 30, C.b, "center"); text("GREAT SCORE", 128, 50, C.r, "center", 2);
  text("ENTER YOUR INITIALS", 128, 76, C.b, "center"); text("SPIN BALL TO CHANGE LETTERS", 128, 90, C.b, "center"); text("PRESS ANY FIRE SWITCH TO SELECT", 128, 104, C.b, "center");
  for (let i = 0; i < 3; i++) { const ch = ALPHA[entry.chars[i]]; const hide = i === entry.pos && (frame >> 3) % 2; if (!hide) text(ch === " " ? "_" : ch, 110 + i * 14, 128, C.y, "left", 2); }
 } else if (state === "theend") {
  drawGround(); drawCities(); drawHud(); for (const b of booms) disc(b.x, b.y, boomR(b.f) * 2.2, EXCOL[(b.f >> 2) % 7]);
  if (stateT > 90) text("THE END", 128, 90, C.r, "center", 3);
 } else {
  drawGround(); drawCities(); drawBases(); drawField(); drawHud();
  if (state === "attract") { text("DEMO", 128, 30, C.b, "center"); text("PRESS FIRE OR TAP TO START", 128, 40, frame % 60 < 40 ? C.y : C.b, "center"); }
  if (state === "banner") { text("PLAYER  1", 128, 70, C.b, "center"); text(mult + " X POINTS", 128, 90, C.b, "center"); text(String(mult), 128 - 27, 90, C.r); text("DEFEND CITIES", 128, 150, C.b, "center"); }
  if (state === "bonus") {
   const B = bonusInfo; text("BONUS POINTS", 128, 50, C.b, "center");
   text(String(B.ammoPts), 80, 80, C.r, "right"); for (let i = 0; i < B.ammoN; i++) { g.fillStyle = pal.city[0]; g.fillRect(88 + i * 4, 82, 1, 3); }
   text(String(B.cityPts), 80, 100, C.r, "right"); for (let i = 0; i < B.cityN; i++) sprite(CITY_SPRITE, 88 + i * 16, 98, pal.city);
   if (B.bonusCity) text("BONUS CITY", 128, 125, C.b, "center");
  }
  if (state === "play" || state === "banner" || (state === "attract" && demo)) drawCursor();
  if (paused) text("PAUSED", 128, 110, C.w, "center", 2);
 }
 vctx.imageSmoothingEnabled = false; vctx.drawImage(buf, 0, 0, view.width, view.height);
}

/* ---------- Input ---------- */
const keys = new Set(); let paused = false;
function pressStart() { if (state === "attract" || (state === "table" && stateT > 60)) { audio(); startGame(); return true; } return false; }
function anyFire(i) {
 audio();
 if (state === "entry") { entryNext(); return; }
 if (pressStart()) return;
 if (state === "play") fire(i);
}
const FIREKEY = { KeyA: 0, KeyZ: 0, Digit1: 0, KeyS: 1, KeyX: 1, Space: 1, Digit2: 1, KeyD: 2, KeyC: 2, Digit3: 2 };
addEventListener("keydown", e => {
 audio();
 if (state === "entry") {
  if (e.code === "ArrowLeft" || e.code === "ArrowDown") entryShift(-1); else if (e.code === "ArrowRight" || e.code === "ArrowUp") entryShift(1);
  else if (/^Key[A-Z]$/.test(e.code) && !e.repeat) entryLetter(e.code[3]); else if ((e.code === "Enter" || e.code === "Space") && !e.repeat) entryNext();
  e.preventDefault(); return;
 }
 if (e.code === "KeyM") { toggleMute(); return; }
 if (e.code === "KeyP" && state === "play") { paused = !paused; return; }
 if (e.code in FIREKEY && !e.repeat) { anyFire(FIREKEY[e.code]); e.preventDefault(); return; }
 if (e.code === "Enter") { pressStart(); return; }
 if (e.code.startsWith("Arrow")) { keys.add(e.code); e.preventDefault(); }
});
addEventListener("keyup", e => keys.delete(e.code));
function moveKeys() { const s = 2.2; if (keys.has("ArrowLeft")) cursor.x -= s; if (keys.has("ArrowRight")) cursor.x += s; if (keys.has("ArrowUp")) cursor.y -= s; if (keys.has("ArrowDown")) cursor.y += s; clampCursor(); }
function clampCursor() { cursor.x = clamp(cursor.x, 8, 247); cursor.y = clamp(cursor.y, CURSOR_MIN_Y, CURSOR_MAX_Y); }
function toLogical(e) { const r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H, sx: W / r.width }; }
// Desktop: the mouse is the trackball (crosshair follows it); click fires from the nearest base with ammo.
// Phone: drag anywhere on the playfield moves the crosshair relatively (like a trackball, finger never covers it);
// a quick tap aims at that spot and fires from the nearest base. The three base buttons fire the left/centre/right base at the crosshair.
let touchState = null, entryAcc = 0;
view.addEventListener("pointerdown", e => {
 e.preventDefault(); audio();
 const p = toLogical(e);
 if (e.pointerType === "mouse") {
  if (state === "entry") { entryNext(); return; }
  if (pressStart()) return;
  if (state === "play" && !paused) { cursor.x = p.x; cursor.y = p.y; clampCursor(); fireNearest(cursor.x, cursor.y); }
  return;
 }
 touchState = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: performance.now(), moved: 0, p };
 try { view.setPointerCapture(e.pointerId); } catch (_) {}
});
view.addEventListener("pointermove", e => {
 if (e.pointerType === "mouse") { const p = toLogical(e); if (state === "entry") { entryAcc += e.movementX || 0; while (Math.abs(entryAcc) > 40) { entryShift(Math.sign(entryAcc)); entryAcc -= Math.sign(entryAcc) * 40; } return; } cursor.x = p.x; cursor.y = p.y; clampCursor(); return; }
 if (!touchState || e.pointerId !== touchState.id) return;
 const r = view.getBoundingClientRect(), k = W / r.width * 1.4, dx = e.clientX - touchState.lx, dy = e.clientY - touchState.ly;
 touchState.lx = e.clientX; touchState.ly = e.clientY; touchState.moved += Math.abs(dx) + Math.abs(dy);
 if (state === "entry") { entryAcc += dx; while (Math.abs(entryAcc) > 28) { entryShift(Math.sign(entryAcc)); entryAcc -= Math.sign(entryAcc) * 28; } return; }
 if (touchState.moved > 10) { cursor.x += dx * k; cursor.y += dy * k; clampCursor(); }
});
function endTouch(e) {
 if (!touchState || e.pointerId !== touchState.id) return;
 const quick = touchState.moved <= 10 && performance.now() - touchState.t0 < 350, p = touchState.p; touchState = null;
 if (!quick) return;
 if (state === "entry") { entryNext(); return; }
 if (pressStart()) return;
 if (state === "play" && !paused) { cursor.x = p.x; cursor.y = p.y; clampCursor(); fireNearest(cursor.x, cursor.y); }
}
view.addEventListener("pointerup", endTouch); view.addEventListener("pointercancel", e => { touchState = null; });
document.querySelectorAll("[data-b]").forEach(btn => {
 const i = +btn.dataset.b;
 btn.addEventListener("pointerdown", e => {
  e.preventDefault(); btn.classList.add("active");
  if (state === "entry") { audio(); if (i === 0) entryShift(-1); else if (i === 2) entryShift(1); else entryNext(); return; }
  anyFire(i);
 });
 const up = () => btn.classList.remove("active"); btn.addEventListener("pointerup", up); btn.addEventListener("pointerleave", up); btn.addEventListener("pointercancel", up);
});
const muteBtn = document.getElementById("btn-mute");
function toggleMute() { muted = !muted; localStorage.setItem("mc_muted_v1", muted ? "1" : "0"); audio(); muteBtn.textContent = muted ? "SOUND OFF" : "SOUND ON"; }
muteBtn.addEventListener("click", e => { e.stopPropagation(); toggleMute(); });
muteBtn.textContent = muted ? "SOUND OFF" : "SOUND ON";
function setTouch() { const t = matchMedia("(pointer:coarse)").matches || navigator.maxTouchPoints > 0; document.body.classList.toggle("touch", t); }
setTouch();
// entry-mode labels on the phone buttons
function syncButtons() { const ent = state === "entry"; document.querySelectorAll("[data-b]").forEach(b => { const want = ent ? ["&#9664;", "OK", "&#9654;"][+b.dataset.b] : ["L", "C", "R"][+b.dataset.b]; if (b.dataset.lbl !== want) { b.dataset.lbl = want; b.innerHTML = want; } }); }

/* ---------- Loop ---------- */
let acc = 0, last = performance.now();
function loop(now) {
 acc += Math.min(250, now - last); last = now;
 while (acc >= STEP) { acc -= STEP; if (!paused) { if (state === "play") moveKeys(); update(); } }
 syncButtons(); draw(); requestAnimationFrame(loop);
}
resetField(); requestAnimationFrame(loop);

window.MISSILE = {
 build: 1, audio: () => (AC ? AC.state : "none"),
 get state() { return { state, score, wave, mult, high, cities: cities.map(c => c.alive), ammo: bases.map(b => b.ammo), basesAlive: bases.map(b => b.alive), enemies: emis.length, enemyLeft, fliers: fliers.map(f => f.kind), booms: booms.length, pmis: pmis.length, cursor: { x: Math.round(cursor.x), y: Math.round(cursor.y) }, bonusStock, nextBonus, bonus: state === "bonus" ? Object.assign({}, bonusInfo) : null, muted, attractPhase, demo }; },
 entry: () => entry && { pos: entry.pos, letters: entry.chars.map(i => ALPHA[i]).join(""), t: entry.t },
 table: () => table.map(e => e[0] + ":" + e[1]),
};
if (DEBUG) window.MISSILE.debug = {
 setScore(s) { score = s; if (s > high) high = s; while (score >= nextBonus) { bonusStock++; nextBonus += 10000; } },
 endGame() { for (const c of cities) c.alive = false; emis = []; booms = []; setState("theend"); },
 skipBanner() { if (state === "banner") stateT = 999; },
 enemy(x, tx) { const t = targets().find(o => Math.abs(o.x - tx) < 3) || pickTarget(); const m = spawnEnemy(x, 8, t); m.splitY = -1; return emis.length; },
 mirv(x) { const m = spawnEnemy(x || 128, 8); m.splitY = 60; m.y = 55; m.sy = 8; },
 bomber(kind) { spawnFlier(kind || "bomber"); fliers[fliers.length - 1].x = 40; fliers[fliers.length - 1].vx = Math.abs(fliers[fliers.length - 1].vx); },
 smart() { spawnEnemy(128, 30, null, "smart"); },
 boomAt(x, y) { boom(x, y, "p"); },
 release() { holdWave = false; },
 hold() { holdWave = true; enemyLeft = 0; bombsLeft = 0; salvoT = 1e9; flierT = 1e9; },
 clearWave() { enemyLeft = 0; bombsLeft = 0; emis = []; fliers = []; pmis = []; booms = []; },
 killCities(n) { for (let i = 0; i < n; i++) cities[i].alive = false; },
 wave(n) { wave = n; beginWave(); },
 invuln(v = true) { invuln = v; },
};
  // -- Audio unlock (sound ON by default): first tap/click/key anywhere resumes Web Audio --
  (function () {
    function silentWav() {
      const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
      const s = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
      s(0, "RIFF"); v.setUint32(4, 36 + n, true); s(8, "WAVEfmt "); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
      v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, "data"); v.setUint32(40, n, true); b.fill(128, 44);
      let str = ""; for (let i = 0; i < b.length; i++) str += String.fromCharCode(b[i]);
      return "data:audio/wav;base64," + btoa(str);
    }
    let tag = null, kicked = null;
    function onGesture() {
      try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch (_) {}
      try { if (!tag) { tag = new Audio(silentWav()); tag.setAttribute("playsinline", ""); tag.loop = true; tag.volume = 0.01; } if (tag.paused) { const p = tag.play(); if (p && p.catch) p.catch(function () {}); } } catch (_) {}
      try { audio(); } catch (_) {}
      try {
        const c = AC;
        if (c) {
          if (c.state !== "running" && c.resume) c.resume().catch(function () {});
          if (kicked !== c) { kicked = c; const sb = c.createBuffer(1, 1, 22050), src = c.createBufferSource(); src.buffer = sb; src.connect(c.destination); src.start(0); }
        }
      } catch (_) {}
    }
    ["pointerdown", "touchstart", "touchend", "mousedown", "click", "keydown"].forEach(function (t) {
      window.addEventListener(t, onGesture, { capture: true, passive: true });
    });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) { try { const c = AC; if (c && c.state === "suspended") c.resume().catch(function () {}); } catch (_) {} } });
    window.__audioInfo = function () { const c = AC; return { ctx: c ? c.state : "none", muted: muted }; };
  })();

})();
