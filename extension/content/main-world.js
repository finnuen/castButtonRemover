/*
 * castButtonRemover — page-world guard
 * ---------------------------------------------------------------------------
 * Runs inside the page's own JavaScript world, in every frame, before any page
 * script executes. It makes casting impossible instead of merely hidden:
 *
 *   1. Removes the Presentation API entry points (second-screen / cast to TV).
 *   2. Makes the Remote Playback API refuse to advertise or start devices.
 *   3. Forces `disableremoteplayback` on every <video>/<audio> (also inside
 *      shadow roots) so the browser's built-in cast button disappears.
 *   4. Tells pages that load the Google Cast sender SDK that Cast is not
 *      available, so they never build their own cast UI.
 *   5. Adds the hide-stylesheet to every shadow root a page creates.
 *
 * Every step sits in its own try/catch: this file must never break a page.
 */
(function () {
  'use strict';

  // Run once per frame / JS realm.
  var GUARD = Symbol.for('nocast.main.v1');
  try {
    if (window[GUARD]) return;
    Object.defineProperty(window, GUARD, { value: true });
  } catch (e) { /* keep going */ }

  // Static hide rules (injected by the build step).
  var CSS_TEXT = "/* castButtonRemover: the hide rules.\n   This file is the single source. tools/hide-rules.mjs copies it verbatim into\n   content/main-world.js (so the same rules reach every shadow root) and derives\n   the KNOWN list in content/dom-guard.js. Edit here; the build regenerates\n   both copies. */\ngoogle-cast-launcher { display: none !important; }\nmedia-cast-button { display: none !important; }\nmedia-google-cast-button { display: none !important; }\nmedia-airplay-button { display: none !important; }\n.ytp-remote-button { display: none !important; }\nytmusic-cast-button { display: none !important; }\n.ytmusic-cast-button { display: none !important; }\n.vjs-chromecast-button { display: none !important; }\n.vjs-chromecast-button-lg { display: none !important; }\n.vjs-airplay-control { display: none !important; }\n.jw-icon-cast { display: none !important; }\n.jw-icon-airplay { display: none !important; }\n.shaka-cast-button { display: none !important; }\n.bmpui-ui-casttogglebutton { display: none !important; }\n.bmpui-ui-airplaytogglebutton { display: none !important; }\n[data-plyr=\"airplay\"] { display: none !important; }\n.chromecast-button { display: none !important; }\n.headerCastButton { display: none !important; }\nbutton[aria-label=\"Chromecast\" i] { display: none !important; }\nbutton[aria-label=\"Google Cast\" i] { display: none !important; }\nbutton[aria-label=\"Cast to device\" i] { display: none !important; }\nbutton[aria-label=\"Cast to devices\" i] { display: none !important; }\nbutton[aria-label=\"Cast to TV\" i] { display: none !important; }\nbutton[aria-label=\"Cast to screen\" i] { display: none !important; }\nbutton[aria-label=\"Cast to Chromecast\" i] { display: none !important; }\nbutton[aria-label=\"Cast to a device\" i] { display: none !important; }\nbutton[aria-label=\"Cast to other device\" i] { display: none !important; }\nbutton[aria-label=\"Cast to another device\" i] { display: none !important; }\nbutton[aria-label=\"Cast to display\" i] { display: none !important; }\nbutton[aria-label=\"AirPlay\" i] { display: none !important; }\nbutton[title=\"Chromecast\" i] { display: none !important; }\nbutton[title=\"Google Cast\" i] { display: none !important; }\nbutton[title=\"Cast to device\" i] { display: none !important; }\nbutton[title=\"Cast to devices\" i] { display: none !important; }\nbutton[title=\"Cast to TV\" i] { display: none !important; }\nbutton[title=\"Cast to screen\" i] { display: none !important; }\nbutton[title=\"Cast to Chromecast\" i] { display: none !important; }\nbutton[title=\"Cast to a device\" i] { display: none !important; }\nbutton[title=\"Cast to other device\" i] { display: none !important; }\nbutton[title=\"Cast to another device\" i] { display: none !important; }\nbutton[title=\"Cast to display\" i] { display: none !important; }\nbutton[title=\"AirPlay\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"Chromecast\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"Google Cast\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"Cast to device\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"Cast to devices\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"Cast to TV\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"Cast to screen\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"Cast to Chromecast\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"Cast to a device\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"Cast to other device\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"Cast to another device\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"Cast to display\" i] { display: none !important; }\n[role=\"button\"][aria-label=\"AirPlay\" i] { display: none !important; }\n[role=\"button\"][title=\"Chromecast\" i] { display: none !important; }\n[role=\"button\"][title=\"Google Cast\" i] { display: none !important; }\n[role=\"button\"][title=\"Cast to device\" i] { display: none !important; }\n[role=\"button\"][title=\"Cast to devices\" i] { display: none !important; }\n[role=\"button\"][title=\"Cast to TV\" i] { display: none !important; }\n[role=\"button\"][title=\"Cast to screen\" i] { display: none !important; }\n[role=\"button\"][title=\"Cast to Chromecast\" i] { display: none !important; }\n[role=\"button\"][title=\"Cast to a device\" i] { display: none !important; }\n[role=\"button\"][title=\"Cast to other device\" i] { display: none !important; }\n[role=\"button\"][title=\"Cast to another device\" i] { display: none !important; }\n[role=\"button\"][title=\"Cast to display\" i] { display: none !important; }\n[role=\"button\"][title=\"AirPlay\" i] { display: none !important; }\n[data-nocast=\"1\"] { display: none !important; }\n";

  // Pristine references, captured before any page script can tamper with them.
  var defineProperty = Object.defineProperty;
  var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  var apply = Reflect.apply;
  var ElementProto = Element.prototype;
  var qsa = ElementProto.querySelectorAll;
  var matches = ElementProto.matches;
  var getAttribute = ElementProto.getAttribute;
  var setAttribute = ElementProto.setAttribute;
  var hasAttribute = ElementProto.hasAttribute;
  var origAttachShadow = ElementProto.attachShadow;
  var addEventListener = EventTarget.prototype.addEventListener;
  var dispatchEvent = EventTarget.prototype.dispatchEvent;
  var NativeCustomEvent = window.CustomEvent;
  var NativeMutationObserver = window.MutationObserver;
  var NativeDOMException = window.DOMException;
  var NativeWeakSet = window.WeakSet;
  var nativePromise = Promise;
  var promiseReject = Promise.reject;
  var promiseResolve = Promise.resolve;
  var nativeSetTimeout = window.setTimeout;

  function safely(fn) {
    try { fn(); } catch (e) { /* never let one patch break the others */ }
  }

  function defineMethod(obj, name, fn) {
    defineProperty(obj, name, { value: fn, writable: true, configurable: true, enumerable: true });
  }

  // -------------------------------------------------------------------------
  // 1. Presentation API (cast a page to another screen)
  // -------------------------------------------------------------------------
  safely(function removePresentationApi() {
    try { delete window.PresentationRequest; } catch (e) { /* ignore */ }
    if ('PresentationRequest' in window) {
      safely(function () {
        defineProperty(window, 'PresentationRequest', { value: undefined, writable: true, configurable: true });
      });
    }
    try { delete Navigator.prototype.presentation; } catch (e) { /* ignore */ }
    if ('presentation' in navigator) {
      safely(function () {
        defineProperty(Navigator.prototype, 'presentation', {
          get: function () { return undefined; },
          configurable: true,
          enumerable: true
        });
      });
    }
  });

  // -------------------------------------------------------------------------
  // 2. Remote Playback API (cast a <video>/<audio> element)
  // -------------------------------------------------------------------------
  safely(function hardenRemotePlayback() {
    var RP = window.RemotePlayback;
    if (typeof RP !== 'function' || !RP.prototype) return;
    var proto = RP.prototype;
    function refusal() {
      return new NativeDOMException('Remote playback is disabled.', 'InvalidStateError');
    }
    defineMethod(proto, 'watchAvailability', function watchAvailability() {
      return apply(promiseReject, nativePromise, [refusal()]);
    });
    defineMethod(proto, 'prompt', function prompt() {
      return apply(promiseReject, nativePromise, [refusal()]);
    });
    defineMethod(proto, 'cancelWatchAvailability', function cancelWatchAvailability() {
      return apply(promiseResolve, nativePromise, [undefined]);
    });
  });

  safely(function forceDisableRemotePlayback() {
    var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    if (!proto) return;
    var d = getOwnPropertyDescriptor(proto, 'disableRemotePlayback');
    defineProperty(proto, 'disableRemotePlayback', {
      configurable: true,
      enumerable: d ? d.enumerable : true,
      get: function () { return true; },
      set: function () { /* ignored on purpose */ }
    });
  });

  // -------------------------------------------------------------------------
  // 3. Keep `disableremoteplayback` on every media element, everywhere
  // -------------------------------------------------------------------------
  var MEDIA_SEL = 'video,audio';
  var NO_REMOTE = /(?:^|\s)noremoteplayback(?:\s|$)/i;

  function secure(el) {
    try {
      if (!apply(hasAttribute, el, ['disableremoteplayback'])) {
        apply(setAttribute, el, ['disableremoteplayback', '']);
      }
      var cl = apply(getAttribute, el, ['controlslist']);
      if (cl === null || !NO_REMOTE.test(cl)) {
        apply(setAttribute, el, ['controlslist', cl ? cl + ' noremoteplayback' : 'noremoteplayback']);
      }
    } catch (e) { /* ignore */ }
  }

  function secureTree(node) {
    try {
      if (!node || node.nodeType !== 1) return;
      if (apply(matches, node, [MEDIA_SEL])) secure(node);
      var list = apply(qsa, node, [MEDIA_SEL]);
      for (var i = 0; i < list.length; i++) secure(list[i]);
    } catch (e) { /* ignore */ }
  }

  function onMutations(records) {
    try {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'attributes') {
          var t = r.target;
          if (t && t.nodeType === 1 && apply(matches, t, [MEDIA_SEL])) secure(t);
        } else {
          var added = r.addedNodes;
          for (var j = 0; j < added.length; j++) secureTree(added[j]);
        }
      }
    } catch (e) { /* ignore */ }
  }

  var observer = null;
  function observe(root) {
    try {
      if (!observer) observer = new NativeMutationObserver(onMutations);
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disableremoteplayback', 'controlslist']
      });
    } catch (e) { /* ignore */ }
  }
  safely(function () { observe(document); });

  // -------------------------------------------------------------------------
  // 4. Shadow roots: same hide-stylesheet + same media enforcement
  // -------------------------------------------------------------------------
  var sheet = null;
  safely(function buildSheet() {
    if (CSS_TEXT && typeof window.CSSStyleSheet === 'function') {
      sheet = new window.CSSStyleSheet();
      sheet.replaceSync(CSS_TEXT);
    }
  });

  function prepareShadow(root) {
    if (sheet) {
      safely(function () {
        var current = root.adoptedStyleSheets;
        var next = [];
        for (var i = 0; i < current.length; i++) next.push(current[i]);
        next.push(sheet);
        root.adoptedStyleSheets = next;
      });
    }
    observe(root);
  }

  safely(function patchAttachShadow() {
    if (typeof origAttachShadow !== 'function') return;
    var patched = function attachShadow(init) {
      var root = apply(origAttachShadow, this, arguments);
      try { prepareShadow(root); } catch (e) { /* ignore */ }
      // Tell the extension-world detector (it cannot see closed roots without this hint).
      try { apply(dispatchEvent, this, [new NativeCustomEvent('nocast:shadow', { bubbles: true, composed: true })]); } catch (e) { /* ignore */ }
      return root;
    };
    defineProperty(ElementProto, 'attachShadow', {
      value: patched, writable: true, configurable: true, enumerable: true
    });
  });

  // -------------------------------------------------------------------------
  // 5. Google Cast sender SDK: always answer "not available"
  // -------------------------------------------------------------------------
  safely(function guardCastCallback() {
    var KEY = '__onGCastApiAvailable';
    var REASON = 'Cast is disabled by the castButtonRemover extension.';
    var stored;
    var existing = getOwnPropertyDescriptor(window, KEY);
    if (existing && 'value' in existing) stored = existing.value;
    var scheduled = new NativeWeakSet();
    var called = new NativeWeakSet();

    function scheduleNotify(fn) {
      if (typeof fn !== 'function' || scheduled.has(fn)) return;
      scheduled.add(fn);
      function run() {
        nativeSetTimeout(function () {
          if (called.has(fn)) return;
          called.add(fn);
          try { apply(fn, window, [false, REASON]); } catch (e) { /* page bug, not ours */ }
        }, 0);
      }
      if (document.readyState === 'loading') {
        apply(addEventListener, document, ['DOMContentLoaded', run, { once: true }]);
      } else {
        run();
      }
    }

    // If anything ever does manage to call the page's callback, it hears "false".
    var wrapper = function (isAvailable, reason) {
      var fn = stored;
      if (typeof fn !== 'function') return undefined;
      called.add(fn);
      return apply(fn, this, [false, REASON]);
    };

    defineProperty(window, KEY, {
      configurable: true,
      enumerable: true,
      get: function () { return typeof stored === 'function' ? wrapper : stored; },
      set: function (fn) { stored = fn; scheduleNotify(fn); }
    });
    if (typeof stored === 'function') scheduleNotify(stored);
  });
})();
