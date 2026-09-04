/* ClimaQuiz 主逻辑 — 适配中文气候分类数据 */
const TOTAL_QUESTIONS = 10;

let globe = null;
let showChart = true;   // 出题时是否显示年内水热柱状图
let climateCells = null;   // 全球陆地逐月气候均值（data/global_climate_0.5deg.json）
let currentCellData = null;  // 当前随机点查到的真实气温/降水
let score = 0, qNum = 0, correctCount = 0, streak = 0, maxStreak = 0;
let currentAnswer = null;        // 当前正确答案（中文类型名称）
let polysByName = null;          // { 名称: MultiPolygon 坐标 } 便于抽题
let cities = [];                 // [{name, country, lat, lng}] 就近匹配地名
let allFeatures = null;          // clime.geojson 全部要素（绘制气候分布图）
let timerId = null;              // 计时器句柄
let baseTexUrl = null, climateTexUrl = null;   // 底图 / 气候图贴图 URL（供切换）

// ---------- 启动 ----------
window.addEventListener("error", e => {
  const el = document.createElement("pre");
  el.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#400;color:#f88;padding:10px;font-size:12px;white-space:pre-wrap";
  el.textContent = "JS ERROR: " + e.message + "\n" + (e.error && e.error.stack || "");
  document.body.appendChild(el);
});

initGlobe();
loadData().then(() => {
  console.log("气候数据加载完成");
  startGame();          // 直接开始，无限时模式
  // 数据加载后布局已稳定，再校正一次地球尺寸（width/height 分开设数字）
  const wrap = document.getElementById("globeWrap");
  if (wrap && globe) globe.width(wrap.clientWidth).height(wrap.clientHeight);
}).catch(err => {
  console.error("数据加载失败", err);
  const el = document.getElementById("locName");
  if (el) el.textContent = "数据加载失败";
});

function initGlobe() {
  // 贴图优先用内联 base64（assets.js），离线 file:// 或打包 exe 下都不会有跨域问题；
  // 否则回退到本地文件（开发期用 http 服务器时）
  const texBM = window.TEX_BLUE_MARBLE || "vendor/earth-blue-marble.jpg";
  const texNT = window.TEX_NIGHT || "vendor/earth-night.jpg";
  globe = Globe()(document.getElementById("globeViz"))
    .globeImageUrl(texBM)
    .bumpImageUrl(texNT)
    .backgroundColor("rgba(0,0,0,0)")
    .atmosphereColor("#4a90ff")
    .atmosphereAltitude(0.22)
    .pointOfView({ lat: 25, lng: 105, altitude: 2.4 });
  // 地球画布尺寸 = 右侧面板(#globeWrap)的真实尺寸（absolute left:320 right:0 → 全窗-320）。
  // 球体在画布内水平居中 → 即落在右侧面板正中。
  // 地球画布尺寸 = 右侧面板(#globeWrap)的真实尺寸。globe.gl 的 width/height 是
  // 两个独立 prop（各自接收单个数字），必须分开设，球在画布内自然居中、正圆、不拉伸。
  const wrap = document.getElementById("globeWrap");
  const fitGlobe = () => {
    if (!wrap || !globe) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w && h) globe.width(w).height(h);
  };
  if ("ResizeObserver" in window) new ResizeObserver(fitGlobe).observe(document.documentElement);
  else window.addEventListener("resize", fitGlobe);
  requestAnimationFrame(fitGlobe);
  setTimeout(fitGlobe, 0);
  setTimeout(fitGlobe, 200);
  setTimeout(fitGlobe, 600);

  // 气候分布图：直接作为地球贴图显示（与 Geoview 验证成功的方案一致）。
  // 优先用内联 base64（assets.js 的 window.TEX_CLIMATE_MAP）——双击 index.html（file://）也能用；
  // 若内联不存在再回退 fetch vendor/map.png（http 服务器场景，便于换图）。
  // 缓存底图与气候图，供开启/关闭气候图时切换。
  baseTexUrl = window.TEX_BLUE_MARBLE || "vendor/earth-blue-marble.jpg";
  climateTexUrl = window.TEX_CLIMATE_MAP || null;
  if (!climateTexUrl) {
    fetch("vendor/map.png", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
      .then(blob => { climateTexUrl = URL.createObjectURL(blob); })
      .catch(() => console.warn("气候图加载失败：缺少 vendor/map.png / 内联图"));
  }
  // 气候图模式：点击地球 → 弹窗显示该点气候类型（仅在气候图开启时响应）
  bindClimateClick();
}

async function loadData() {
  // 离线优先：直接读内联数据（assets.js 的 window.CLIME_DATA），无需联网/服务器。
  // 也兼容通过 http 服务器 fetch 原始 geojson 的情况（开发期）。
  let gj = null;
  if (window.CLIME_DATA && window.CLIME_DATA.features) {
    gj = window.CLIME_DATA;
  } else {
    try { gj = await (await fetch("data/clime-simplified.geojson")).json(); }
    catch (e1) {
      try { gj = await (await fetch("data/clime.geojson")).json(); }
      catch (e2) { gj = await (await fetch("data/koppen.geojson")).json(); }
    }
  }
  polysByName = {};
  for (const f of gj.features) {
    const name = f.properties["类型名称"] || f.properties.name || f.properties.CODE || "未知";
    polysByName[name] = f.geometry;
  }
  allFeatures = gj.features;   // 绘制冷色气候分布图用
  await loadCities();
  // 加载全球陆地逐月气候均值（用于随机点的真实气温/降水柱状图）。
  // 走 http 服务器（start.bat）可 fetch；file:// 双击会被 CORS 拦截，catch 后回退典型值。
  try {
    const cl = await (await fetch("data/global_climate_0.5deg.json", { cache: "no-store" })).json();
    if (cl && cl.lats_land) climateCells = cl;
  } catch (e) { console.warn("气候格点数据加载失败，柱状图将用典型值", e); }
}

// 加载城市库（Natural Earth 1:110m 主要城市），用于就近显示地名
async function loadCities() {
  let cj = null;
  if (window.CITIES_DATA && window.CITIES_DATA.features) {
    cj = window.CITIES_DATA;
  } else {
    try { cj = await (await fetch("data/cities.geojson")).json(); }
    catch (e) { cj = null; }
  }
  if (cj) {
    cities = cj.features.map(f => {
      const p = f.properties;
      return { name: p.NAME, country: p.ADM0NAME, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    });
  } else { cities = []; }
}

// 找离 (lat,lng) 最近的城市（球面近似：先按经纬度直角距离粗筛，再算大圆距离）
function nearestCity(lat, lng) {
  if (!cities.length) return null;
  let best = null, bestD = Infinity;
  for (const c of cities) {
    const dLat = c.lat - lat, dLng = (c.lng - lng) * Math.cos(lat * Math.PI / 180);
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) { bestD = d; best = c; }
  }
  // 近似公里数：1°≈111km
  const km = Math.sqrt(bestD) * 111;
  return { city: best, km };
}

// ---------- 抽点：在多边形内取一个尽量远离边界的点 ----------
// 阈值（度）：落点至少离所属气候多边形边界这么远，避免压在气候类型分界线上
const EDGE_MARGIN_DEG = 2.0;   // ≈ 220km
function pointToSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
// 点到多边形所有边界线段的最小距离（度）
function minDistToRings(px, py, rings) {
  let d = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const dd = pointToSegDist(px, py, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
      if (dd < d) d = dd;
    }
  }
  return d;
}
function randomPointInPolygon(rings) {
  const outer = rings[0];
  let minX = 180, maxX = -180, minY = 90, maxY = -90;
  for (const [x, y] of outer) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  let best = null, bestDist = -1;
  for (let i = 0; i < 200; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    if (!inRing(x, y, outer)) continue;
    let inHole = false;
    for (let h = 1; h < rings.length; h++) if (inRing(x, y, rings[h])) { inHole = true; break; }
    if (inHole) continue;
    const d = minDistToRings(x, y, rings);
    if (d >= EDGE_MARGIN_DEG) return [x, y];      // 达标立即用
    if (d > bestDist) { bestDist = d; best = [x, y]; }  // 记录最靠内的候选
  }
  return best || outer[0].slice();                 // 退回最靠内点或首顶点
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// 取某类型内一个随机点：先在气候的多个子块间随机选一块，再在块内取远离边界的点
function samplePoint(name) {
  const g = polysByName[name];
  const blocks = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
  // 随机选一个子块（让热带雨林轮换亚马逊/刚果/东南亚，温带大陆性轮换各段…而不是永远第0块）
  const block = blocks[Math.floor(Math.random() * blocks.length)];
  const rings = g.type === "MultiPolygon" ? block : g.coordinates;
  const pt = randomPointInPolygon(rings);
  return { pt, lng: pt[0], lat: pt[1] };
}

// ---------- 出题 ----------
// 各气候出题权重：极地气候简单，权重调低（约 3%），出现概率更小；其余正常（权重=1）
const CLIMATE_WEIGHT = {
  "极地气候": 0.34
};
function pickClimateName(last) {
  const names = Object.keys(polysByName);
  const weights = names.map(n => n === last ? 0 : (CLIMATE_WEIGHT[n] || 1));
  let total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {  // 兜底：所有气候都被排除（理论上不会），退化为不加权
    for (let i = 0; i < names.length; i++) weights[i] = (CLIMATE_WEIGHT[names[i]] || 1);
    total = weights.reduce((a, b) => a + b, 0);
  }
  let r = Math.random() * total;
  for (let i = 0; i < names.length; i++) {
    r -= weights[i];
    if (r <= 0) return names[i];
  }
  return names[names.length - 1];
}
function newQuestion() {
  if (qNum >= TOTAL_QUESTIONS) return endGame();
  let name, pt;
  for (let t = 0; t < 60; t++) {
    name = pickClimateName(currentAnswer);  // 避免与上一题相同气候
    const r = samplePoint(name);
    pt = r.pt;
    if (Math.abs(pt[1]) < 83) break;
  }
  currentAnswer = name;
  qNum++; updateHUD();

  flyTo(pt[1], pt[0]);
  placeMarker(pt[1], pt[0]);
  const coordStr = `${fmtCoord(pt[1],"lat")}, ${fmtCoord(pt[0],"lng")}`;
  document.getElementById("locName").textContent = describePoint(pt);   // 仅显示经纬度，不显示城市
  document.getElementById("coords").textContent = coordStr;

  // 用随机点经纬度查最近陆地格，获取真实逐月气温/降水（无数据则回退典型值）
  currentCellData = climateCells ? nearestCell(pt[1], pt[0]) : null;

  buildOptions(name);
  showPanel("quizPanel");
  hideFeedback();
  // 出题即显示该随机点的年内水热柱状图（真实数据优先，受开关控制）
  if (showChart) showClimateChart(name);
  startTimer();
}

function describePoint([lng, lat]) {
  const ns = lat >= 0 ? "北纬" : "南纬";
  const ew = lng >= 0 ? "东经" : "西经";
  return `${ns}${Math.abs(lat).toFixed(1)}° ${ew}${Math.abs(lng).toFixed(1)}°`;
}
function fmtCoord(v, t) {
  return `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(1)}°${t === "lat" ? (v >= 0 ? "N" : "S") : (v >= 0 ? "E" : "W")}`;
}

function flyTo(lat, lng) { globe.pointOfView({ lat, lng, altitude: 1.3 }, 1400); }

// ---------- 标注物：脉冲环 + 醒目红点 + 标签（全部用 globe.gl 内置层） ----------
function placeMarker(lat, lng) {
  // 脉冲扩散环，明确指示位置
  globe.ringsData([{ lat, lng }])
       .ringColor(() => t => `rgba(255,80,80,${1 - t})`)
       .ringMaxRadius(5)
       .ringPropagationSpeed(2.2)
       .ringRepeatPeriod(1100);
  // 醒目的红色标记点
  globe.pointsData([{ lat, lng }])
       .pointLat("lat").pointLng("lng")
       .pointColor(() => "#ff2d2d")
       .pointAltitude(0.05)
       .pointRadius(0.45);
  // 地名标签
  globe.labelsData([{ lat, lng, text: "📍 目标点" }])
       .labelLat("lat").labelLng("lng")
       .labelColor(() => "#ffffff")
       .labelSize(1.7)
       .labelDotRadius(0.4)
       .labelResolution(2)
       .labelAltitude(0.14);
}
function clearMarker() {
  globe.ringsData([]); globe.pointsData([]); globe.labelsData([]);
}

// ---------- 全球气候分布图（直接作为地球贴图显示，与 Geoview 验证成功的方案一致） ----------
let mapOn = false;
function toggleClimateMap() {
  const btn = document.getElementById("btnMap");
  if (!climateTexUrl) {
    if (btn) { btn.textContent = "数据加载中…"; setTimeout(() => { if (!mapOn) btn.textContent = "🌐 气候图"; }, 1200); }
    console.warn("气候图：贴图未就绪");
    return;
  }
  mapOn = !mapOn;
  if (mapOn) {
    globe.globeImageUrl(climateTexUrl);     // 气候图直接覆盖地球表面
    btn.classList.add("active");
    btn.textContent = "🌐 关闭图";
    globe.pointOfView({ lat: 20, lng: 105, altitude: 2.6 }, 1000);
  } else {
    globe.globeImageUrl(baseTexUrl);        // 恢复蓝色大理石底图
    btn.classList.remove("active");
    btn.textContent = "🌐 气候图";
  }
}

// ---------- 气候图模式：点击地球任意点 → 弹窗显示该点气候类型 ----------
// 判定直接用内联的矢量 geojson（与 Geoview 完全一致的射线法命中），
// 不读 png 像素颜色（png 颜色块位置和人直觉可能有出入，矢量才是权威）。
// 屏幕显示的气候图与矢量 geojson 数据共享同一套经纬度，因此弹窗名称与所见区域严格一致。
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function climateAtPoint(lat, lng) {
  const gj = window.CLIME_DATA;
  if (!gj || !gj.features) return null;
  for (const f of gj.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates]
                : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const rings of polys) {
      if (!pointInRing(lng, lat, rings[0])) continue;
      let inHole = false;
      for (let k = 1; k < rings.length; k++) if (pointInRing(lng, lat, rings[k])) { inHole = true; break; }
      if (!inHole) return f.properties["类型名称"] || f.properties.name || f.properties.CODE || "未知";
    }
  }
  return null;   // 海洋/无数据区
}

// 在气候格点数据里找离 (lat,lng) 最近的陆地格，返回其真实逐月气温/降水
function nearestCell(lat, lng) {
  if (!climateCells) return null;
  const { lats_land, lons_land, tavg, prec } = climateCells;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < lats_land.length; i++) {
    const dLat = lats_land[i] - lat, dLng = lons_land[i] - lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) return null;
  return { temp: tavg[best], prep: prec[best] };
}

// 气候图点击：把属性信息写到左侧面板的「信息区」（#infoBody），不再用浮窗
function showClimateInfo(lat, lng) {
  const name = climateAtPoint(lat, lng);
  const c = CLIMATES[name] || {};
  const body = document.getElementById("infoBody");
  if (!body) return;
  const latS = lat >= 0 ? `${lat.toFixed(2)}°N` : `${(-lat).toFixed(2)}°S`;
  const lngS = lng >= 0 ? `${lng.toFixed(2)}°E` : `${(-lng).toFixed(2)}°W`;
  if (name) {
    const swatch = c.color
      ? `<span class="swatch" style="background:${c.color}"></span>` : "";
    body.innerHTML =
      `<div class="pop-name">${swatch}${name}</div>` +
      (c.desc ? `<div class="pop-desc">${c.desc}</div>` : "") +
      `<div class="pop-coord">📍 ${latS} · ${lngS}</div>`;
  } else {
    body.innerHTML =
      `<div class="pop-ocean">🌊 海洋（无气候类型）</div>` +
      `<div class="pop-desc">该点不在陆地气候分区内。</div>` +
      `<div class="pop-coord">📍 ${latS} · ${lngS}</div>`;
  }
}

// 只在地图模式下绑定点击：mapOn 时点击地球弹窗，否则不响应（避免答题时误触）
function bindClimateClick() {
  globe.onGlobeClick(({ lat, lng }) => {
    if (mapOn) showClimateInfo(lat, lng);
  });
}

// ---------- 选项（全部 12 种） ----------
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function buildOptions(answer) {
  // 固定按热量带排序（热带→亚热带→温带→寒带），不每题打乱
  const opts = ALL_CLIMATES;
  const box = document.getElementById("options");
  box.innerHTML = "";
  opts.forEach(name => {
    const b = document.createElement("button");
    b.textContent = name.replace(/气候$/, "");   // 显示时去掉末尾“气候”二字
    b.className = "zone-" + zoneOf(name);          // 按热量带着色
    b.dataset.name = name;                         // 存完整名用于答案判定/高亮
    b.onclick = () => answerPick(name, b);
    box.appendChild(b);
  });
}
// 按气候名称判断热量带（用于按钮配色）
function zoneOf(name) {
  if (name.indexOf("热带") === 0) return "tropical";        // 热带*
  if (name.indexOf("亚热带") === 0) return "subtropical";   // 亚热带*
  if (name === "季风性湿润气候" || name === "地中海气候") return "subtropical"; // 也属亚热带
  if (name.indexOf("温带") === 0) return "temperate";        // 温带*
  if (name.indexOf("极地") === 0) return "polar";            // 极地*
  if (name.indexOf("高原山地") === 0) return "plateau";      // 高原山地*
  return "other";
}

// ---------- 语音播报（Web Speech API，离线使用系统中文语音） ----------
let zhVoice = null;
let speechOn = true;   // 语音总开关（HUD 的 🔊 按钮切换）
function pickZhVoice() {
  if (!("speechSynthesis" in window)) return null;
  const vs = speechSynthesis.getVoices();
  // 优先简体中文，其次任意含 "Chinese/zh" 的语音
  return vs.find(v => /zh[-_]?CN/i.test(v.lang)) ||
         vs.find(v => /zh/i.test(v.lang)) ||
         vs.find(v => /chinese/i.test(v.name)) || null;
}
if ("speechSynthesis" in window) {
  zhVoice = pickZhVoice();
  speechSynthesis.onvoiceschanged = () => { zhVoice = pickZhVoice(); };
}
function speak(text) {
  if (!speechOn) return;                      // 总开关关闭则不播报
  if (!("speechSynthesis" in window)) return;   // 当前浏览器不支持则静默
  try {
    speechSynthesis.cancel();                  // 取消上一条，避免排队堆积
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    if (zhVoice) u.voice = zhVoice;
    u.rate = 1.0; u.pitch = 1.0;
    speechSynthesis.speak(u);
  } catch (e) { /* 忽略朗读异常，不影响答题 */ }
}

function answerPick(picked, btn) {
  disableOptions();
  const ok = picked === currentAnswer;
  if (ok) {
    score += 10 + streak * 2;
    correctCount++; streak++;
    maxStreak = Math.max(maxStreak, streak);
    btn.classList.add("correct");
    speak("正确，你选的是" + picked);
  } else {
    streak = 0;
    btn.classList.add("wrong");
    highlightCorrect();
    speak("答错了，正确答案是" + currentAnswer);
  }
  updateHUD();
  scheduleAutoNext();   // 先安排自动下一题（即使反馈渲染异常也不阻塞推进）
  showFeedback(ok, false);
}
function disableOptions() { document.querySelectorAll("#options button").forEach(b => b.disabled = true); }
// 答完/超时后 2 秒自动进入下一题；手动点「下一题」会清除计时器避免重复
let autoNextId = null;
function scheduleAutoNext() {
  clearTimeout(autoNextId);
  autoNextId = setTimeout(() => { hideFeedback(); newQuestion(); }, 2000);
}
function cancelAutoNext() { clearTimeout(autoNextId); }
function highlightCorrect() {
  document.querySelectorAll("#options button").forEach(b => { if (b.dataset.name === currentAnswer) b.classList.add("correct"); });
}

// ---------- 气候类型年内水热柱状图（纯 SVG，无依赖） ----------
// 优先用真实格点数据 cell={temp:[12],prep:[12]}；无则回退该气候类型典型值
function climateChartSVG(name, cell) {
  const real = cell && cell.temp && cell.prep;
  const d = real ? cell : (window.CLIMATE_CHART && window.CLIMATE_CHART[name]);
  if (!d) return "";
  const temp = d.temp, prep = d.prep;
  const W = 300, H = 176, padL = 22, padR = 30, padT = 14, padB = 30;
  const months = ["1","2","3","4","5","6","7","8","9","10","11","12"];
  const tMax = 40, tMin = -30;                 // 气温轴范围 ℃
  const pMax = Math.max(...prep, 10) * 1.15; // 降水轴上限 mm
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x0 = padL, y0 = padT + plotH;
  const bw = plotW / 12;
  const ty = v => padT + (tMax - v) / (tMax - tMin) * plotH;   // 气温→y
  const py = v => padT + (1 - v / pMax) * plotH;               // 降水→y
  const FZ = 9;  // 坐标轴/刻度字号（加大）
  let bars = "", line = "", pts = "", labels = "";
  for (let i = 0; i < 12; i++) {
    const cx = x0 + bw * i + bw / 2;
    const ph = y0 - py(prep[i]);                 // 降水柱高
    bars += `<rect x="${(x0 + bw * i + 1).toFixed(1)}" y="${py(prep[i]).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${ph.toFixed(1)}" fill="rgba(90,160,255,.55)"/>`;
    const yy = ty(temp[i]);
    pts += `${cx.toFixed(1)},${yy.toFixed(1)} `;
    labels += `<text x="${cx.toFixed(1)}" y="${H - 12}" font-size="${FZ}" fill="#9fb3d1" text-anchor="middle">${months[i]}</text>`;
  }
  line = `<polyline points="${pts.trim()}" fill="none" stroke="#ff7a59" stroke-width="1.6"/>`;
  for (let i = 0; i < 12; i++) {
    const cx = x0 + bw * i + bw / 2;
    const yy = ty(temp[i]);
    line += `<circle cx="${cx.toFixed(1)}" cy="${yy.toFixed(1)}" r="1.8" fill="#ff7a59"/>`;
  }
  // 轴线与刻度（气温轴在左，降水轴在右）
  const pTicks = [0, Math.round(pMax/2), Math.round(pMax)];
  const pTickTxt = pTicks.map(v => `<text x="${(W - padR + 4).toFixed(1)}" y="${(py(v)+3).toFixed(1)}" font-size="${FZ}" fill="#5aa0ff">${v}</text>`).join("");
  const axis =
    `<line x1="${x0}" y1="${padT}" x2="${x0}" y2="${y0}" stroke="#3a4a66"/>` +
    `<line x1="${W - padR}" y1="${padT}" x2="${W - padR}" y2="${y0}" stroke="#3a4a66"/>` +
    `<line x1="${x0}" y1="${y0}" x2="${W - padR}" y2="${y0}" stroke="#3a4a66"/>` +
    pTickTxt +
    `<text x="2" y="${ty(30).toFixed(1)}" font-size="${FZ}" fill="#ff7a59">30</text>` +
    `<text x="2" y="${ty(0).toFixed(1)}" font-size="${FZ}" fill="#ff7a59">0</text>` +
    `<text x="2" y="${ty(-20).toFixed(1)}" font-size="${FZ}" fill="#ff7a59">-20</text>` +
    `<text x="${(W - padR + 4).toFixed(1)}" y="${padT - 4}" font-size="${FZ}" fill="#5aa0ff">降水(mm)</text>` +
    `<text x="2" y="${padT - 4}" font-size="${FZ}" fill="#ff7a59">气温(℃)</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${name}年内气温降水">` +
    bars + line + axis + labels + `</svg>`;
}
// 把当前随机点的水热柱状图写入信息区（真实格点数据优先，缺则回退典型值）
function showClimateChart(name) {
  const body = $("infoBody");
  if (!body) return;
  const real = currentCellData && currentCellData.temp && currentCellData.prep;
  const hint = real ? "本题随机点实测水热（WorldClim 多年平均）：" : "本题气候类型典型水热（多年平均）：";
  body.innerHTML =
    `<div class="info-hint">${hint}</div>` +
    `<div class="chart-box">${climateChartSVG(name, currentCellData)}</div>`;
}

// ---------- 反馈（写入左侧信息区 #infoBody） ----------
function showFeedback(ok, timeout) {
  const body = document.getElementById("infoBody");
  if (!body) return;
  const c = CLIMATES[currentAnswer] || {};
  body.innerHTML =
    `<div class="fb-title ${ok ? "ok" : "bad"}">${ok ? "✅ 回答正确！" : timeout ? "⏱ 时间到！" : "❌ 回答错误"}</div>` +
    `<div class="fb-detail"><b>${currentAnswer}</b><br>${c.desc || ""}</div>`;
}
function hideFeedback() {
  const body = document.getElementById("infoBody");
  if (body) body.innerHTML =
    '<div class="info-hint">🖱️ 开启右上「🌐 气候图」后点击地球，查看该点气候类型；或直接答题。</div>';
}

// ---------- 计时（无限时模式，仅在名称上保留兼容） ----------
function selectedMode() { return 0; }   // 固定无限时
function startTimer() {
  clearInterval(timerId);
  document.title = "ClimaQuiz — 世界气候分布测试";
}

// ---------- HUD / 流程 ----------
function updateHUD() {
  document.getElementById("qnum").textContent = qNum;
  document.getElementById("score").textContent = score;
  document.getElementById("streak").textContent = streak;
  document.getElementById("accuracy").textContent = qNum ? Math.round(correctCount / qNum * 100) + "%" : "—";
}
function showPanel(id) {
  // 仅切换答题面板与结算面板（开始界面已移除，启动即直接答题）
  const quiz = document.getElementById("quizPanel");
  const end = document.getElementById("endScreen");
  if (quiz) quiz.style.display = (id === "quizPanel") ? "flex" : "none";
  if (end) end.classList.toggle("hidden", id !== "endScreen");
}
function startGame() {
  try {
    score = 0; qNum = 0; correctCount = 0; streak = 0; maxStreak = 0;
    clearInterval(timerId); clearMarker(); hideFeedback();
    newQuestion();
  } catch (err) {
    const el = document.createElement("pre");
    el.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#400;color:#f88;padding:10px;font-size:12px;white-space:pre-wrap";
    el.textContent = "startGame ERROR: " + err.message + "\n" + (err.stack || "");
    document.body.appendChild(el);
  }
}
function endGame() {
  clearInterval(timerId); clearMarker();
  showPanel("endScreen");
  document.getElementById("finalScore").textContent = score;
  document.getElementById("finalCorrect").textContent = correctCount;
  document.getElementById("finalTotal").textContent = TOTAL_QUESTIONS;
  document.getElementById("finalStreak").textContent = maxStreak;
  const acc = correctCount / TOTAL_QUESTIONS;
  document.getElementById("rank").textContent =
    acc >= .9 ? "🏆 气候大师！" : acc >= .7 ? "🌟 地理高手" : acc >= .5 ? "📖 继续加油" : "🌱 多看看地图吧";
  globe.pointOfView({ lat: 25, lng: 105, altitude: 2.6 }, 1200);
}

const $ = id => document.getElementById(id);
function bind(id, fn) { const el = $(id); if (el) el.onclick = fn; else console.warn("未找到 #"+id); }
bind("btnRestart", startGame);
bind("btnNext", () => { cancelAutoNext(); hideFeedback(); newQuestion(); });
bind("btnMap", toggleClimateMap);
bind("btnMapClose", toggleClimateMap);
// 水热图开关
bind("btnChart", () => {
  showChart = !showChart;
  const el = $("btnChart");
  el.textContent = showChart ? "📊 水热图 开" : "📊 水热图 关";
  el.classList.toggle("hud-on", showChart);
  if (showChart) {                       // 实时刷新当前题的图表
    showClimateChart(currentAnswer);
  }
});
// 语音开关：点一下在 开/关 之间切换
bind("btnSpeak", () => {
  speechOn = !speechOn;
  const el = $("btnSpeak");
  el.textContent = speechOn ? "🔊 语音 开" : "🔇 语音 关";
  if (speechOn) speak("语音已开启");
});
// 退出程序：仅在打包成 exe / 本地启动器运行时有效（访问 /__exit 终止本地服务器与进程）
bind("btnExit", () => {
  if (confirm("确定要退出 ClimaQuiz 吗？")) {
    // 发请求让启动器终止自身；请求会超时（进程已死），故用不等待的方式发送
    const img = new Image();
    img.src = "/__exit?t=" + Date.now();
    // 同时尝试 fetch（更易控），失败也无所谓
    try { fetch("/__exit", { cache: "no-store" }); } catch (e) {}
    setTimeout(() => window.close(), 300);
  }
});
