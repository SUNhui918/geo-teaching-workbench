/* 交互课件 ↔ 教学工具 关联表
 * 总开关：把下面的 enabled 改成 false，工作台首页的标签和课件底部的“配套工具”行就全部消失，恢复原样。
 * 增删关联：只改 MAP；key 是课件标题，value 是工具 key 列表（见 TOOLS）。纯本地，断网可用（链接需联网/同目录打开）。 */
(function () {
  var enabled = true;

  var TOOLS = {
    moon:   { t: '月相演示', u: '月相.html' },
    star:   { t: '恒星视运动·天球模型', u: '恒星视运动·天球模型.html' },
    strata: { t: '地层侦探', u: '地层侦探.html' },
    fossil: { t: '古生物图谱', u: 'gushengwutupu/gushengwutupu.html' },
    rock:   { t: '岩石图谱', u: 'yanshitupu/yanshitupu.html' },
    circ:   { t: '大气环流交互模拟器', u: '大气环流交互模拟器.html' },
    current:{ t: '世界洋流分布图', u: '世界洋流分布图.html' },
    geo3d:  { t: '3D地质模型', u: '3D地质模型.html' },
    jsterr: { t: '江苏3D地形', u: '江苏3D地形.html' },
    czterr: { t: '常州3D地形', u: '常州3D地形.html' },
    contour:{ t: '等高线地形图（清明山和茅山）', u: '等高线地形图清明山与茅山.html' },
    terr:   { t: '在线地形图', u: '地形图.html' },
    zone:   { t: '世界陆地自然带', u: '世界陆地自然带.html' },
    clim:   { t: '世界气候分布图', u: '世界气候分布图.html' },
    front:  { t: 'AI地理实验室：锋与天气', u: '锋与天气.html' },
    price:  { t: '常州城区地价模型', u: '常州城区地价模型.html' },
    expand: { t: '江苏常州城市扩张1995-2025', u: '江苏常州城市扩张1995-2025.html' },
    atlas:  { t: '中国·世界地理教学常用图', u: '教学地图集.html' }
  };

  // 课件标题 → 工具
  var MAP = {
    '地球的宇宙环境': ['moon', 'star'],
    '地球的历史': ['strata', 'fossil'],
    '地球的圈层结构': ['rock'],
    '大气受热过程和大气运动': ['circ'],
    '海水的运动': ['current'],
    '常见地貌类型': ['geo3d', 'jsterr', 'terr'],
    '地貌的观察': ['contour', 'czterr', 'terr'],
    '植被': ['zone', 'clim'],
    '土壤': ['zone'],
    '地质灾害': ['geo3d'],
    '气象与水文灾害': ['front'],
    '地理信息技术在防灾减灾中的应用': ['terr'],
    '人口分布': ['terr', 'atlas'],
    '乡村和城镇空间结构': ['price'],
    '城镇化': ['expand'],
    '农业区位因素及其变化': ['clim', 'zone'],
    '中国国家发展战略举例': ['atlas']
  };

  function list(title) { return (MAP[title] || []).map(function (k) { return TOOLS[k]; }); }
  // 反查：工具标题 → 课件标题列表
  function usedBy(toolTitle) {
    var r = [];
    Object.keys(MAP).forEach(function (c) {
      MAP[c].forEach(function (k) { if (TOOLS[k].t === toolTitle) r.push(c); });
    });
    return r;
  }
  window.GEO_RELATIONS = { enabled: enabled, toolsFor: function (t) { return enabled ? list(t) : []; }, usedBy: function (t) { return enabled ? usedBy(t) : []; } };

  // 课件页：在页脚前插入“配套工具”行（仅文件名以“交互课件.html”结尾的页面）
  var name = decodeURIComponent((location.pathname.split('/').pop() || ''));
  if (!enabled || !/交互课件\.html$/.test(name)) return;
  var tools = list(name.replace(/交互课件\.html$/, ''));
  if (!tools.length) return;
  function mount() {
    if (document.getElementById('geo-relations')) return;
    var box = document.createElement('div');
    box.id = 'geo-relations';
    box.className = 'noprint';
    box.style.cssText = 'max-width:1200px;margin:10px auto 0;padding:10px 14px;border:1px dashed rgba(120,200,190,.45);border-radius:10px;font-size:14px;color:#9fb4c8;display:flex;flex-wrap:wrap;gap:8px;align-items:center';
    box.innerHTML = '<span>🧰 配套工具（需联网，新标签页打开）：</span>' + tools.map(function (x) {
      return '<a href="' + x.u + '" target="_blank" rel="noopener" style="color:#7fe0d0;border:1px solid rgba(127,224,208,.45);border-radius:14px;padding:3px 12px;text-decoration:none">' + x.t + ' ↗</a>';
    }).join('');
    var f = document.querySelector('footer');
    if (f && f.parentNode) f.parentNode.insertBefore(box, f); else document.body.appendChild(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
