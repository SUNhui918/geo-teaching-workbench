/* 地理智能化教学工作台 · 悬浮工具条（右下角）
 * 纯 JS 动态生成，样式类名统一 wb- 前缀，不加载任何外部资源，断网可用。
 * 用法：在工具页 </body> 前加 <script src="lib/workbench-bar.js"></script>
 *      （gushengwutupu / yanshitupu 子文件夹页面写 ../lib/workbench-bar.js）
 * 位置：右下角，收起为小圆标签，展开面板向上弹出；自动避让页面右下角已有的署名/水印 */
(function () {
  if (window.__wbBarInited) return;
  window.__wbBarInited = true;

  // 判断是否在子文件夹：脚本 src 以 ../ 开头即子目录页面
  var cur = document.currentScript;
  var src = cur && cur.getAttribute('src') ? cur.getAttribute('src') : '';
  var isSub = src.indexOf('../') === 0;
  var homeUrl = isSub ? '../index.html' : 'index.html';

  var css = [
    '.wb-bar{position:fixed;right:14px;bottom:14px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}',
    '.wb-bar *{box-sizing:border-box;}',
    '.wb-toggle{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border:1px solid rgba(43,184,163,.45);border-radius:50%;background:rgba(255,255,255,.9);color:#14796a;font-size:20px;line-height:1;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.2);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);-webkit-tap-highlight-color:transparent;transition:background .2s,transform .2s;}',
    '.wb-toggle:hover{background:#fff;}',
    '.wb-bar.open .wb-toggle{background:rgba(43,184,163,.15);}',
    '.wb-panel{display:none;flex-direction:column;gap:6px;padding:10px;background:rgba(255,255,255,.92);border:1px solid rgba(43,184,163,.3);border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,.18);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);min-width:150px;}',
    '.wb-bar.open .wb-panel{display:flex;}',
    '.wb-btn{display:flex;align-items:center;justify-content:center;gap:5px;min-width:44px;min-height:40px;padding:8px 12px;border:1px solid rgba(43,184,163,.4);border-radius:10px;background:rgba(43,184,163,.12);color:#14796a;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;letter-spacing:.3px;-webkit-tap-highlight-color:transparent;transition:background .2s,color .2s;}',
    '.wb-btn:hover{background:rgba(43,184,163,.24);}',
    '.wb-btn .ic{font-size:16px;line-height:1;}',
    '.wb-sign{font-size:11px;color:#5a6b7a;text-align:center;padding:2px 2px 0;line-height:1.5;letter-spacing:.3px;white-space:nowrap;}'
  ].join('\n');

  var style = document.createElement('style');
  style.id = 'wb-bar-style';
  style.textContent = css;
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.className = 'wb-bar';

  var panel = document.createElement('div');
  panel.className = 'wb-panel';

  var btnHome = document.createElement('button');
  btnHome.className = 'wb-btn';
  btnHome.type = 'button';
  btnHome.innerHTML = '<span class="ic">🏠</span>返回工作台';

  var btnFs = document.createElement('button');
  btnFs.className = 'wb-btn';
  btnFs.type = 'button';
  btnFs.id = 'wbBarFs';
  btnFs.innerHTML = '<span class="ic">⛶</span>全屏';

  var sign = document.createElement('div');
  sign.className = 'wb-sign';
  sign.textContent = '地理智能化教学工作台';

  panel.appendChild(btnHome);
  panel.appendChild(btnFs);
  panel.appendChild(sign);

  var toggle = document.createElement('button');
  toggle.className = 'wb-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', '展开或收起工作台工具条');
  toggle.textContent = '🧭';

  bar.appendChild(panel);
  bar.appendChild(toggle);
  document.body.appendChild(bar);

  // 智能避让：页面右下角已有固定定位的署名/水印元素时，工具条整体上移，不遮挡
  try {
    var bottom = 14;
    document.querySelectorAll('body div').forEach(function (el) {
      if (bar.contains(el)) return;
      var cs = window.getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') return;
      var rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.width > 420) return;
      var b = parseFloat(cs.bottom) || 0;
      var r = parseFloat(cs.right) || 0;
      if (b < 70 && r < 300) {
        var need = Math.round(b + rect.height + 10);
        if (need > bottom && need < 200) bottom = need;
      }
    });
    bar.style.bottom = bottom + 'px';
  } catch (e) {}

  toggle.addEventListener('click', function () {
    bar.classList.toggle('open');
  });

  btnHome.addEventListener('click', function () {
    if (window.opener) {
      try { window.close(); } catch (e) {}
      setTimeout(function () {
        if (!document.hidden) { location.href = homeUrl; }
      }, 250);
    } else {
      location.href = homeUrl;
    }
  });

  function getFs() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || null;
  }
  function updateFsLabel() {
    btnFs.innerHTML = getFs() ? '<span class="ic">✕</span>退出全屏' : '<span class="ic">⛶</span>全屏';
  }
  btnFs.addEventListener('click', function () {
    if (getFs()) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
    } else {
      var el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (el.mozRequestFullScreen) el.mozRequestFullScreen();
    }
  });
  document.addEventListener('fullscreenchange', updateFsLabel);
  document.addEventListener('webkitfullscreenchange', updateFsLabel);
  document.addEventListener('mozfullscreenchange', updateFsLabel);
  updateFsLabel();

  // 51.la 匿名访问统计（断网加载失败时静默，不影响页面使用）
  try {
    var st = document.createElement('script');
    st.charset = 'UTF-8';
    st.id = 'LA_COLLECT';
    st.src = 'https://sdk.51.la/js-sdk-pro.min.js';
    st.async = true;
    st.onload = function () {
      try { if (window.LA && LA.init) LA.init({ id: '3Ro1Q4EnHnqPZ1Xo', ck: '3Ro1Q4EnHnqPZ1Xo' }); } catch (e) {}
    };
    st.onerror = function () {};
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}
})();
