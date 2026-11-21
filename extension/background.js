// castButtonRemover service worker.
//
// The content scripts are registered here instead of being declared in the
// manifest, because an extension that can be switched off, and switched off for
// individual sites, must inject nothing at all on a page it is not meant to
// touch. Registration is decided by the browser before the page runs, so the
// page world never sees an API patched that should have been left alone - a
// manifest script gated by a storage read could not promise that, since
// chrome.storage answers asynchronously while page scripts run immediately.
//
// The network layer works the same way: the block rules are dynamic, and the
// site list travels with them as initiatorDomains / excludedInitiatorDomains, so
// a site the extension is off for is not touched even at the request level.
//
// Settings live in chrome.storage.sync; when a sync backend silently refuses the
// write (some browsers do when signed out) the popup stores them in
// chrome.storage.local instead and sets __storeMode, which is honoured here the
// same way the popup reads it back.

'use strict';

const DEFAULTS = { enabled: true, mode: 'blacklist', whitelist: [], blacklist: [] };

// The URLs a page fetches to build a Cast button. These are the four filters
// that used to sit in rules/cast-sdk.json, unchanged.
const BLOCKED = [
  '||gstatic.com/cv/js/sender/',
  '||gstatic.com/cast/sdk/libs/sender/',
  '/cast_sender.js',
  '/cast_framework.js',
];
const RULE_IDS = BLOCKED.map((_, i) => i + 1);

const SCRIPT_IDS = ['cbr-css', 'cbr-main', 'cbr-guard'];

// A hostname from the popup, or anything else ignored. Dots are optional so
// "localhost" can be listed; a match pattern is built from it below.
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

function hosts(list) {
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const host = String(raw == null ? '' : raw).trim().toLowerCase().replace(/^www\./, '');
    if (HOST_RE.test(host)) seen.add(host);
  }
  return [...seen];
}

// "*://*.example.com/*" matches example.com and every subdomain of it.
const patternFor = (host) => `*://*.${host}/*`;

function readSettings() {
  return new Promise((resolve) => {
    const done = (sync) => {
      chrome.storage.local.get(null, (local) => {
        const out = Object.assign({}, DEFAULTS, sync || {});
        if (local && local.__storeMode === 'local') {
          for (const key of Object.keys(DEFAULTS)) {
            if (key in local) out[key] = local[key];
          }
        }
        resolve(out);
      });
    };
    try {
      chrome.storage.sync.get(DEFAULTS, (sync) => done(sync));
    } catch {
      done(null);
    }
  });
}

// --- what to inject ---------------------------------------------------------

function contentScripts(settings) {
  const listed = hosts(settings.mode === 'whitelist' ? settings.whitelist : settings.blacklist);
  const whitelist = settings.mode === 'whitelist';

  // Whitelist mode with nothing listed means "nowhere", which is also what an
  // empty list means there: nothing to protect yet.
  if (whitelist && !listed.length) return [];

  const common = {
    matches: whitelist ? listed.map(patternFor) : ['<all_urls>'],
    // Always present, even when empty: updateContentScripts() only replaces the
    // properties it is given, so a mode switch back to whitelist would otherwise
    // keep excluding the domains the blacklist had, and the two would cancel out.
    excludeMatches: whitelist ? [] : listed.map(patternFor),
    allFrames: true,
    runAt: 'document_start',
    matchOriginAsFallback: true,
    persistAcrossSessions: true,
  };

  return [
    Object.assign({ id: 'cbr-css', css: ['content/hide.css'] }, common),
    Object.assign({ id: 'cbr-main', js: ['content/main-world.js'], world: 'MAIN' }, common),
    Object.assign({ id: 'cbr-guard', js: ['content/dom-guard.js'] }, common),
  ];
}

// --- what to block ----------------------------------------------------------

function networkRules(settings) {
  const whitelist = settings.mode === 'whitelist';
  const listed = hosts(whitelist ? settings.whitelist : settings.blacklist);
  if (whitelist && !listed.length) return [];

  const site = whitelist
    ? { initiatorDomains: listed }
    : (listed.length ? { excludedInitiatorDomains: listed } : {});

  return BLOCKED.map((urlFilter, i) => ({
    id: RULE_IDS[i],
    priority: 1,
    action: { type: 'block' },
    condition: Object.assign({ urlFilter, isUrlFilterCaseSensitive: false }, site),
  }));
}

// --- applying ---------------------------------------------------------------

async function apply() {
  const settings = await readSettings();
  const on = settings.enabled !== false;

  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
  const wanted = on ? contentScripts(settings) : [];

  if (!wanted.length) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: SCRIPT_IDS });
  } else if (registered.length === wanted.length) {
    // Same three scripts, different site list: update in place, so there is no
    // moment in which nothing is registered and a loading page slips through.
    await chrome.scripting.updateContentScripts(wanted);
  } else {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: SCRIPT_IDS });
    await chrome.scripting.registerContentScripts(wanted);
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: RULE_IDS,
    addRules: on ? networkRules(settings) : [],
  });
}

// Saves can arrive in bursts (a list entry added right after the toggle), and
// two overlapping apply() calls would unregister what the other just
// registered. One queue, one apply at a time, latest settings win.
let queue = Promise.resolve();

function schedule() {
  queue = queue.then(apply).catch((err) => {
    console.warn('[castButtonRemover] could not apply settings:', err);
  });
  return queue;
}

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' && area !== 'local') return;
  if (changes.enabled || changes.mode || changes.whitelist || changes.blacklist || changes.__storeMode) {
    schedule();
  }
});

// The worker can be started for any reason at all; make sure what it finds is
// what the settings say, in case a previous run was interrupted.
schedule();
