/*
 * castButtonRemover — DOM guard (extension world)
 * ---------------------------------------------------------------------------
 * Runs in every frame at document_start, in the extension's isolated world so
 * page scripts cannot tamper with the DOM APIs it uses. It:
 *
 *   - hides known cast buttons (player libraries, custom elements),
 *   - recognises unknown ones by name, label, icon or icon-font ligature,
 *   - looks inside open AND closed shadow roots,
 *   - keeps `disableremoteplayback` on every <video>/<audio>,
 *   - re-checks on DOM changes and on a timer, so late or re-created buttons
 *     are caught too.
 *
 * Controls are hidden (display:none !important), never removed, so frameworks
 * that manage the DOM (React, Vue, ...) cannot crash on a missing node.
 * Everything is wrapped so that an error here can never reach the page.
 */
(function () {
  'use strict';

  try {
    if (window.__noCastDomGuard) return;
    Object.defineProperty(window, '__noCastDomGuard', { value: true });
  } catch (e) { /* keep going */ }

  // Known selectors (injected by the build step; precise, high confidence).
  var KNOWN = ["google-cast-launcher","media-cast-button","media-google-cast-button","media-airplay-button",".ytp-remote-button","ytmusic-cast-button",".ytmusic-cast-button",".vjs-chromecast-button",".vjs-chromecast-button-lg",".vjs-airplay-control",".jw-icon-cast",".jw-icon-airplay",".shaka-cast-button",".bmpui-ui-casttogglebutton",".bmpui-ui-airplaytogglebutton","[data-plyr=\"airplay\"]",".chromecast-button",".headerCastButton"];
  var ATTR = 'data-nocast';

  // ---- small helpers -------------------------------------------------------
  var probe = document.createDocumentFragment();

  function validOnly(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      try { probe.querySelector(list[i]); out.push(list[i]); } catch (e) { /* drop bad selector */ }
    }
    return out;
  }

  function qsa(node, sel) {
    if (!sel) return [];
    try { return node.querySelectorAll(sel); } catch (e) { return []; }
  }

  function each(list, fn) {
    for (var i = 0; i < list.length; i++) {
      try { fn(list[i]); } catch (e) { /* ignore */ }
    }
  }

  function norm(s) {
    return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function words(s) {
    return String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  function shadowOf(el) {
    try {
      if (typeof chrome !== 'undefined' && chrome.dom && chrome.dom.openOrClosedShadowRoot) {
        return chrome.dom.openOrClosedShadowRoot(el);
      }
    } catch (e) { /* fall through */ }
    try { return el.shadowRoot || null; } catch (e) { return null; }
  }

  function matchesSel(el, sel) {
    try { return !!sel && el.matches(sel); } catch (e) { return false; }
  }

  // ---- vocabulary ----------------------------------------------------------
  var KNOWN_SEL = validOnly(KNOWN).join(',');

  var LIGATURE_SEL = validOnly([
    '.material-icons', '.material-icons-outlined', '.material-icons-round', '.material-icons-sharp',
    '.material-icons-two-tone', '.material-symbols-outlined', '.material-symbols-rounded',
    '.material-symbols-sharp', '[class*="material-icons" i]', '[class*="material-symbols" i]',
    'mat-icon', '.mat-icon', '.google-symbols', '.gm-icons'
  ]).join(',');
  var LIGATURES = { cast: 1, cast_connected: 1, cast_for_education: 1, airplay: 1 };

  // Which attributes we read (kept short on purpose: every extra one costs time on huge pages).
  var TOKEN_ATTRS = ['class', 'id', 'data-testid', 'data-test', 'data-qa', 'data-cy', 'data-uia', 'data-automation-id', 'data-action', 'data-plyr'];
  var LABEL_ATTRS = ['aria-label', 'title', 'alt', 'data-tooltip', 'data-title', 'data-tip', 'data-original-title'];
  var ICON_ATTRS = ['data-icon', 'data-feather', 'data-lucide', 'fonticon', 'icon', 'name'];
  // Cheap pre-test: does this string contain "cast" as its own word/segment (cast-button, castButton,
  // my_cast, Google Cast), a brand word, or "airplay"? Rejects podcast / broadcast / forecast / overcast.
  var HINT_A = /(?:^|[^a-z])cast|chromecast|googlecast|gcast|miracast|air ?play/i;
  var HINT_B = /[a-z]Cast/;           // camelCase: headerCastButton
  var HINT_RE = { test: function (v) { return HINT_A.test(v) || HINT_B.test(v); } };

  var PRE = [];
  [TOKEN_ATTRS, LABEL_ATTRS, ICON_ATTRS].forEach(function (list) {
    list.forEach(function (attr) {
      var sel = '[' + attr + '*="cast" i]';
      if (PRE.indexOf(sel) === -1) PRE.push(sel);
    });
  });
  ['class', 'id', 'aria-label', 'title', 'data-testid', 'data-plyr'].forEach(function (attr) {
    PRE.push('[' + attr + '*="airplay" i]');
  });
  PRE.push(
    '[aria-label*="air play" i]', '[title*="air play" i]',
    'use[*|href*="cast" i]', 'use[href*="cast" i]',
    'svg > title',
    // Material "cast" glyph drawn as an inline SVG path (Google and MDI variants).
    'path[d*="M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7"]',
    'path[d*="V8H3V5H21V19H14V21H21A2,2 0 0,0 23,19V5C23,3.89 22.1,3 21,3Z"]'
  );
  var PRE_SEL = validOnly(PRE.concat(LIGATURE_SEL ? [LIGATURE_SEL] : [])).join(',');

  var TEXT_SEL = 'button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],summary';

  var SKIP = {};
  ('html head body main script style link meta noscript template video audio source track iframe ' +
   'frame frameset object embed canvas picture form table thead tbody tfoot tr td th ul ol dl ' +
   'select option optgroup textarea section article aside nav header footer h1 h2 h3 h4 h5 h6 p ' +
   'pre code blockquote figure figcaption dialog details fieldset legend').split(' ').forEach(function (t) {
    SKIP[t] = 1;
  });

  // ---- name / label recognition -------------------------------------------
  var STRONG_W = { chromecast: 1, googlecast: 1, gcast: 1, miracast: 1, airplay: 1 };
  var CTRL_W = { button: 1, btn: 1, icon: 1, ico: 1, launcher: 1, toggle: 1, control: 1, trigger: 1, picker: 1 };
  var COMPOUND_RE = /^(chromecast|googlecast|gcast|cast)(button|btn|icon|launcher|toggle)$/;

  // Confidence: 2 = certain; 1 = probable (icon-only control, or inside a player);
  // 0.5 = weak (only inside a player); 0 = no.
  function wordsLevel(w) {
    var best = 0;
    for (var i = 0; i < w.length; i++) {
      var x = w[i], p = w[i - 1], n = w[i + 1], m;
      if ((m = COMPOUND_RE.exec(x))) { best = Math.max(best, m[1] === 'cast' ? 1 : 2); continue; }
      if (STRONG_W[x] === 1) {
        if (CTRL_W[p] === 1 || CTRL_W[n] === 1) return 2;
        continue;
      }
      if (x === 'cast') {
        if (p === 'google' || n === 'launcher' || p === 'launcher') return 2;
        if (CTRL_W[p] === 1 || CTRL_W[n] === 1 || n === 'to') best = Math.max(best, 1);
      }
    }
    return best;
  }

  function tokensLevel(v) {
    var best = 0;
    var toks = String(v).split(/\s+/);
    for (var i = 0; i < toks.length && best < 2; i++) {
      var t = toks[i];
      if (!t || t.length > 80) continue;
      best = Math.max(best, wordsLevel(words(t)));
    }
    return best;
  }

  var STRONG_LABELS = [
    /^(?:google ?cast|chrome ?cast|google chromecast)$/,
    /^cast to (?:a |an |the |your |other |another |nearby )?(?:device|devices|tv|television|screen|display|monitor|speaker|speakers|receiver|chromecast|google cast|smart tv)$/,
    /^cast (?:this )?(?:tab|screen|video|page)$/,
    /^(?:start|stop) casting(?: to .+)?$/,
    /^casting to .+$/,
    /^air ?play(?: (?:and|or|&) (?:cast|chromecast|google cast))?$/,
    /^(?:cast|chromecast|google cast) ?(?:and|or|&|\/) ?air ?play$/,
    /^(?:connect to|connected to|disconnect from) (?:a )?(?:chromecast|cast device)$/
  ];

  function labelLevel(raw) {
    var s = norm(raw).replace(/[\u2026.:\s]+$/, '');
    if (!s || s.length > 50) return 0;
    for (var i = 0; i < STRONG_LABELS.length; i++) {
      if (STRONG_LABELS[i].test(s)) return 2;
    }
    return s === 'cast' ? 0.5 : 0;   // the bare word is ambiguous (actors, 'post a cast', spells...)
  }

  var ICON_NAME_RES = [
    /^(?:(?:mdi|md|mat|material|material-symbols|ion|ionicons|bi|bx|bxs|ri|ti|lucide|feather|fa|fas|far|fab|ph|eva|carbon|tabler|icon|ic|i|uil|uim)[-_:])?(?:cast|chromecast|google-?cast)(?:[-_](?:connected|outline|sharp|line|fill|filled|solid|regular|bold|light|thin|duotone|rounded|alt))?$/,
    /^(?:ic|baseline|outline|round|sharp|twotone)[-_]cast(?:[-_](?:connected|black|white|gr[ae]y|\d+(?:px|dp)))*$/
  ];
  function iconNameMatches(v) {
    var s = norm(v);
    if (!s || s.length > 60) return false;
    for (var i = 0; i < ICON_NAME_RES.length; i++) if (ICON_NAME_RES[i].test(s)) return true;
    return false;
  }

  var ICON_CLASS_RE = /^(?:bi|mdi|zmdi|lucide|feather|ri|ti|bx|bxs|fa|fas|far|fab|fal|fad|fa-solid|fa-regular|ph|icon|icn|i|ion|ionicon|eva|iconoir|uil|uim|carbon|icon-tabler|tabler-icon|anticon|el-icon|svg-icon|glyphicon|codicon|oi|la|las|lar|lab|icofont|ic)[-_](?:cast|chromecast|cast[-_](?:connected|outline|sharp|line|fill|filled|solid|regular|bold|light|thin|duotone))$/;
  var ICON_FONT_RE = /^(?:material-icons(?:-[a-z-]+)?|material-symbols(?:-[a-z-]+)?|mat-icon|mdi|zmdi|icon|icons|fa|fas|far|fab|fal|fad|fa-solid|fa-regular|glyphicon|bi|ti|ri|bx|bxs|ion|ionicon|eva|iconify)$/;
  var ICON_NAME_TOKENS = { cast: 1, cast_connected: 1, 'cast-connected': 1, chromecast: 1, cast_for_education: 1 };

  function iconClassLevel(c) {
    var toks = c.split(/\s+/), font = false, name = false;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i].toLowerCase();
      if (ICON_CLASS_RE.test(t)) return 2;
      if (ICON_FONT_RE.test(t)) font = true;
      if (ICON_NAME_TOKENS[t] === 1) name = true;
    }
    return font && name ? 2 : 0;
  }

  var USE_HREF_RE = /#(?:icon[-_]|ic[-_]|svg[-_]|i[-_]|symbol[-_])?(?:cast|chromecast|google-?cast)(?:[-_](?:connected|outline|sharp|line|fill|filled|solid))?$/i;
  var MATERIAL_CAST_D = ['M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7', 'V8H3V5H21V19H14V21H21A2,2 0 0,0 23,19V5C23,3.89 22.1,3 21,3Z'];

  // ---- visible text, link and context helpers ----------------------------
  function visibleText(el) {
    var out = '';
    try {
      var w = document.createTreeWalker(el, 4, null);
      var n;
      while ((n = w.nextNode())) {
        var p = n.parentNode && n.parentNode.localName;
        if (p === 'title' || p === 'desc' || p === 'style' || p === 'script') continue;
        out += n.nodeValue;
        if (out.length > 120) break;
      }
    } catch (e) { out = el.textContent || ''; }
    return norm(out);
  }

  function hasOwnText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true;
    }
    return false;
  }

  function isRealLink(el) {
    if (el.localName !== 'a') return false;
    var h = el.getAttribute('href');
    if (!h) return false;
    h = h.trim();
    return !(h === '' || h.charAt(0) === '#' || /^javascript:/i.test(h));
  }

  var PLAYER_HINT_RE = /video-?js|player|(?:^|[\s_-])(?:video|vjs|plyr|shaka|bmpui|mejs|controlbar|playback)(?:[\s_-]|$)/i;

  function inPlayerContext(el) {
    var a = el;
    for (var i = 0; i < 8 && a && a.nodeType === 1; i++, a = a.parentElement) {
      var t = a.localName;
      if (t === 'video' || t === 'audio') return true;
      if (a !== el) {
        var cls = a.getAttribute('class') || '';
        var id = a.getAttribute('id') || '';
        if (PLAYER_HINT_RE.test(cls) || PLAYER_HINT_RE.test(id)) return true;
        // A small container that holds a media element is a player; <body>/<main> are not.
        if (i < 6 && t !== 'body' && t !== 'html' && t !== 'main') {
          try {
            if (a.querySelector('video,audio') && a.getElementsByTagName('*').length <= 600) return true;
          } catch (e) { /* ignore */ }
        }
      }
    }
    return false;
  }

  var INTERACTIVE_SEL = 'button,[role="button"],[role="menuitem"],[role="menuitemradio"],' +
    '[role="menuitemcheckbox"],[role="switch"],[role="tab"],summary,[tabindex],[onclick],' +
    'input[type="button"],input[type="image"],a:not([href]),a[href^="#"],a[href^="javascript:" i],label';

  function isInteractive(el) { return matchesSel(el, INTERACTIVE_SEL); }

  function reasonableControl(node, matched) {
    try {
      if (node.childElementCount > 4) return false;
      if (visibleText(node).length > 40) return false;
      if (node.querySelector('video,audio,iframe,canvas,input,select,textarea')) return false;
      var inner = node.querySelectorAll(INTERACTIVE_SEL);
      for (var i = 0; i < inner.length; i++) {
        if (inner[i] !== matched && !matched.contains(inner[i])) return false;
      }
      return true;
    } catch (e) { return false; }
  }

  // Finds what to hide: the clickable control that wraps the matched node.
  function resolveTarget(el) {
    var cur = el;
    var lastSole = el;
    for (var depth = 0; depth < 4 && cur; depth++) {
      if (isInteractive(cur)) return reasonableControl(cur, el) ? cur : lastSole;
      var p = cur.parentElement;
      if (!p) break;
      var t = p.localName;
      if (t === 'body' || t === 'html' || t === 'video' || t === 'audio') break;
      if (!isInteractive(p) && (p.childElementCount > 1 || hasOwnText(p))) break;
      if (depth < 2 && !isInteractive(p)) lastSole = p;
      cur = p;
    }
    return lastSole;
  }

  // ---- classification ------------------------------------------------------
  // Attribute / name based. Every attribute is first checked with one cheap regex.
  function classifyAttrs(el) {
    var tag = el.localName;
    if (!tag) return 0;

    if (tag === 'title') { // <svg><title>Cast</title>...</svg>
      var par = el.parentNode;
      return par && par.localName === 'svg' ? labelLevel(el.textContent) : 0;
    }
    if (SKIP[tag] === 1 || el.childElementCount > 12) return 0;

    var level = 0, i, v;

    if (tag.indexOf('-') > 0 && HINT_RE.test(tag)) level = wordsLevel(words(tag));

    for (i = 0; i < TOKEN_ATTRS.length && level < 2; i++) {
      v = el.getAttribute(TOKEN_ATTRS[i]);
      if (v && HINT_RE.test(v)) level = Math.max(level, tokensLevel(v));
    }

    if (level < 2) {
      for (i = 0; i < ICON_ATTRS.length; i++) {
        v = el.getAttribute(ICON_ATTRS[i]);
        if (!v || !HINT_RE.test(v)) continue;
        if (ICON_ATTRS[i] === 'name' && !/(?:^|-)icon$/.test(tag)) continue;
        if (iconNameMatches(v)) { level = 2; break; }
      }
    }

    if (level < 2) {
      for (i = 0; i < LABEL_ATTRS.length; i++) {
        v = el.getAttribute(LABEL_ATTRS[i]);
        if (v && HINT_RE.test(v)) {
          level = Math.max(level, labelLevel(v));
          if (level === 2) break;
        }
      }
    }

    if (level < 2) {
      v = el.getAttribute('class');
      if (v && HINT_RE.test(v)) level = Math.max(level, iconClassLevel(v));
    }

    if (level < 2 && LIGATURE_SEL) {
      var lt = el.textContent;
      if (lt && lt.length < 24 && HINT_RE.test(lt) && matchesSel(el, LIGATURE_SEL) && LIGATURES[norm(lt)] === 1) level = 2;
    }

    if (level < 2 && tag === 'use') {
      v = el.getAttribute('href') || el.getAttribute('xlink:href');
      if (v && USE_HREF_RE.test(v)) level = 2;
    }

    if (level < 2 && tag === 'path') {
      v = el.getAttribute('d');
      if (v) {
        for (i = 0; i < MATERIAL_CAST_D.length; i++) {
          if (v.indexOf(MATERIAL_CAST_D[i]) !== -1) { level = 2; break; }
        }
      }
    }
    return level;
  }

  // Visible-text based (menu items and buttons that literally say "Cast to device").
  function isTextControl(el) {
    var t = el.localName;
    if (t === 'button' || t === 'summary') return true;
    var r = el.getAttribute('role');
    return r === 'button' || r === 'menuitem' || r === 'menuitemradio' || r === 'menuitemcheckbox';
  }

  function classifyText(el) {
    if (!isTextControl(el) || el.childElementCount > 12) return 0;
    var tc = el.textContent;
    if (!tc || tc.length > 80 || !HINT_RE.test(tc)) return 0;
    return labelLevel(visibleText(el)) === 2 ? 2 : 0;
  }

  function accept(el, level) {
    if (isRealLink(el)) return false;
    var text = visibleText(el);
    if (text.length > 60) return false;
    if (level >= 2) return true;
    if (level >= 1 && text === '') return true;   // icon-only control with a cast-like name
    return inPlayerContext(el);                   // anything weaker: only inside a video player
  }

  // ---- acting on matches ---------------------------------------------------
  function mark(el) {
    try {
      if (!hiddenSeen.has(el)) {
        hiddenSeen.add(el);
        try { if (observer) observer.observe(el, HIDE_OBS); } catch (e) { /* ignore */ }
      }
      if (el.getAttribute(ATTR) !== '1') el.setAttribute(ATTR, '1');
      var st = el.style;
      if (st && (st.getPropertyValue('display') !== 'none' || st.getPropertyPriority('display') !== 'important')) {
        st.setProperty('display', 'none', 'important');
      }
    } catch (e) { /* ignore */ }
  }

  function hide(el) {
    if (!el || el.nodeType !== 1) return;
    var t = el.localName;
    if (t === 'html' || t === 'body' || t === 'head') return;
    mark(el);
    // An emptied <li>/menu row would leave a bullet or gap behind.
    var p = el.parentElement;
    if (p) {
      var pt = p.localName, role = p.getAttribute('role');
      if ((pt === 'li' || role === 'menuitem' || role === 'listitem' || role === 'presentation') &&
          p.childElementCount === 1 && !hasOwnText(p)) {
        mark(p);
      }
    }
  }

  function actOn(el, level) {
    if (!level) return;
    var base = el.localName === 'title' ? el.parentElement : el;
    if (!base || !accept(base, level)) return;
    hide(resolveTarget(base));
  }
  function processAttrs(el) { actOn(el, classifyAttrs(el)); }
  function processText(el) { actOn(el, classifyText(el)); }

  var NO_REMOTE = /(?:^|\s)noremoteplayback(?:\s|$)/i;
  function secure(el) {
    try {
      if (!el.hasAttribute('disableremoteplayback')) el.setAttribute('disableremoteplayback', '');
      var cl = el.getAttribute('controlslist');
      if (cl === null || !NO_REMOTE.test(cl)) el.setAttribute('controlslist', cl ? cl + ' noremoteplayback' : 'noremoteplayback');
    } catch (e) { /* ignore */ }
  }

  // ---- scanning ------------------------------------------------------------
  var watched = new WeakSet();
  var rootRefs = [];
  var observer = null;
  var dirty = true;                 // the DOM changed since the last full sweep
  var OBS_OPTS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disableremoteplayback', 'controlslist']
  };

  function sizeOf(node) {
    try {
      if (node.getElementsByTagName) return node.getElementsByTagName('*').length;
      return qsa(node, '*').length;                       // ShadowRoot / fragment
    } catch (e) { return 0; }
  }

  function watchRoot(sr) {
    if (watched.has(sr)) return;
    watched.add(sr);
    try { rootRefs.push(new WeakRef(sr)); } catch (e) { /* ignore */ }
    try { if (observer) observer.observe(sr, OBS_OPTS); } catch (e) { /* ignore */ }
    scanNow(sr, true);
  }

  // deep = also ask the browser for CLOSED shadow roots on ordinary elements (rare sweeps only).
  function checkHost(el, deep) {
    var t = el.localName || '';
    var custom = t.indexOf('-') > 0;
    if (custom && (t.indexOf('cast') !== -1 || t.indexOf('airplay') !== -1)) processAttrs(el);
    if (!custom && !deep) return;
    var sr = shadowOf(el);
    if (sr) watchRoot(sr);
  }

  function scanSelf(el, deep) {
    try { if (matchesSel(el, KNOWN_SEL)) hide(el); } catch (e) { /* ignore */ }
    try { processAttrs(el); } catch (e) { /* ignore */ }
    try { processText(el); } catch (e) { /* ignore */ }
    try { if (el.localName === 'video' || el.localName === 'audio') secure(el); } catch (e) { /* ignore */ }
    try { checkHost(el, deep); } catch (e) { /* ignore */ }
  }

  function scanDescendants(node, deep) {
    each(qsa(node, KNOWN_SEL), hide);
    each(qsa(node, PRE_SEL), processAttrs);
    each(qsa(node, TEXT_SEL), processText);
    each(qsa(node, 'video,audio'), secure);
    each(qsa(node, '*'), function (el) { checkHost(el, deep); });
  }

  // node: Element | Document | ShadowRoot
  function scanTree(node, deep) {
    if (node.nodeType === 1) scanSelf(node, deep);
    scanDescendants(node, deep);
  }

  // Large subtrees are scanned in small time slices so the page never freezes.
  var SPLIT_AT = 1500, SLICE_MS = 8;
  var queue = [], qHead = 0, pumping = false;

  function enqueue(node, deep) {
    queue.push(node, deep ? 1 : 0);
    if (!pumping) { pumping = true; setTimeout(pump, 0); }
  }

  function pump() {
    var deadline = performance.now() + SLICE_MS;
    try {
      while (qHead < queue.length) {
        var node = queue[qHead++];
        var deep = queue[qHead++] === 1;
        try { processItem(node, deep); } catch (e) { /* ignore */ }
        if (performance.now() > deadline) break;
      }
    } catch (e) { /* ignore */ }
    if (qHead < queue.length) { setTimeout(pump, 0); return; }
    queue.length = 0; qHead = 0; pumping = false;
  }

  function processItem(node, deep) {
    if (node.nodeType === 1 && !node.isConnected) return;
    if (node.nodeType === 11 && !(node.host && node.host.isConnected)) return;
    if (sizeOf(node) > SPLIT_AT && node.firstElementChild) {
      if (node.nodeType === 1) scanSelf(node, deep);
      for (var c = node.firstElementChild; c; c = c.nextElementSibling) enqueue(c, deep);
    } else {
      scanTree(node, deep);
    }
  }

  // Small things right now (no flicker); big things in slices.
  function scanNow(node, deep) {
    if (sizeOf(node) <= SPLIT_AT) scanTree(node, deep); else enqueue(node, deep);
  }

  function requestSweep(deep, force) {
    if (!force && !dirty) return;
    dirty = false;
    try { if (document.documentElement) enqueue(document.documentElement, deep); } catch (e) { /* ignore */ }
    for (var i = rootRefs.length - 1; i >= 0; i--) {
      var r = rootRefs[i].deref();
      if (!r) { rootRefs.splice(i, 1); continue; }
      enqueue(r, deep);
    }
  }

  // ---- reacting to DOM changes --------------------------------------------
  var pending = new Set();
  var overflow = false;
  var timer = 0;
  var HIDE_OBS = { attributes: true, attributeFilter: ['style', 'data-nocast', 'hidden', 'class'] };
  var hiddenSeen = new WeakSet();

  function scheduleFlush() {
    if (!timer) timer = setTimeout(flush, 40);
  }

  function flush() {
    timer = 0;
    try {
      var nodes = Array.from(pending);
      pending.clear();
      if (overflow) { overflow = false; requestSweep(false, true); return; }
      var snap = new Set(nodes);
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n.isConnected) continue;
        var covered = false;
        for (var p = n.parentNode; p; p = p.parentNode) {
          if (snap.has(p)) { covered = true; break; }
        }
        if (!covered) scanNow(n, false);
      }
    } catch (e) { /* ignore */ }
  }

  function onMutations(records) {
    try {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'attributes') {
          var t = r.target;
          if (!t || t.nodeType !== 1) continue;
          if (hiddenSeen.has(t)) mark(t);                     // a framework wiped our hide: put it back
          else if (t.localName === 'video' || t.localName === 'audio') secure(t);
          continue;
        }
        var added = r.addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          dirty = true;
          if (pending.size > 4000) overflow = true; else pending.add(n);
        }
      }
      if (pending.size || overflow) scheduleFlush();
    } catch (e) { /* ignore */ }
  }

  // The page-world script announces every shadow root a page creates (see main-world.js).
  function onShadowEvent(e) {
    try {
      var t = (e.composedPath && e.composedPath()[0]) || e.target;
      var sr = t && t.nodeType === 1 ? shadowOf(t) : null;
      if (!sr) return;
      dirty = true;
      if (watched.has(sr)) enqueue(sr, true); else watchRoot(sr);
    } catch (err) { /* ignore */ }
  }

  try {
    observer = new MutationObserver(onMutations);
    observer.observe(document, OBS_OPTS);
  } catch (e) { /* the timers below still work */ }

  // ---- start ---------------------------------------------------------------
  // `hiddenSeen`/`observer` are defined below `mark`, but only used at run time, after this point.
  scanTree(document, false);
  try { document.addEventListener('nocast:shadow', onShadowEvent, true); } catch (e) { /* ignore */ }
  setTimeout(function () { requestSweep(true, true); }, 1500);   // once: also finds declarative closed roots
  setTimeout(function () { requestSweep(false, false); }, 6000);
  setInterval(function () { if (!document.hidden) requestSweep(false, false); }, 30000);
  try {
    window.addEventListener('load', function () { setTimeout(function () { requestSweep(false, false); }, 300); }, true);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) requestSweep(false, false); }, true);
  } catch (e) { /* ignore */ }
})();
