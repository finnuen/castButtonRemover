// castButtonRemover popup: the on/off switch and the two site lists.
//
// Nothing here has to run on a page: the service worker reads the same settings
// and decides what to register for each site, so a change made here reaches the
// browser before the next page loads.

const DEFAULTS = { enabled: true, mode: 'blacklist', whitelist: [], blacklist: [] };

const enabledEl = document.getElementById('enabled');
const stateHint = document.getElementById('stateHint');
const modeEl = document.getElementById('mode');
const addInput = document.getElementById('addInput');
const siteBtn = document.getElementById('siteBtn');
const hintEl = document.getElementById('hint');
const siteListEl = document.getElementById('siteList');

let siteHost = null;

const BIN_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">' +
  '<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

// Only real web pages have a hostname worth listing: a chrome-extension:// or
// edge:// page reports its own ID as the host, which must not reach the list.
function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

// Normalizes whatever the user typed into a bare hostname.
function normalizeHost(text) {
  const t = text.trim();
  if (!t) return null;
  try {
    const u = new URL(t.includes('://') ? t : 'https://' + t);
    return u.hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function activeList(settings) {
  return settings.mode === 'whitelist' ? settings.whitelist : settings.blacklist;
}

function inList(list, host) {
  return (list || []).some((d) => host === d || host.endsWith('.' + d));
}

// --- storage -----------------------------------------------------------------
// Sync is authoritative, but if sync silently refuses writes (some browsers do
// when their sync backend is signed out), local storage holds the real values,
// flagged with __storeMode - the same rule background.js applies when reading.
function readSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (sync) => {
      chrome.storage.local.get(null, (local) => {
        const out = { ...DEFAULTS, ...sync };
        if (local && local.__storeMode === 'local') {
          for (const k of Object.keys(DEFAULTS)) {
            if (k in local) out[k] = local[k];
          }
        }
        resolve(out);
      });
    });
  });
}

// Write to sync, then read back to make sure it stuck - a sync backend that
// swallows writes would otherwise lose a change silently. When it did not
// stick, fall back to local storage.
async function save(patch) {
  const keys = Object.keys(patch);
  try { await chrome.storage.sync.set(patch); } catch {}
  let ok = false;
  try {
    const check = await chrome.storage.sync.get(keys);
    ok = keys.every((k) => JSON.stringify(check[k]) === JSON.stringify(patch[k]));
  } catch {}
  if (ok) {
    try { await chrome.storage.local.remove([...keys, '__storeMode']); } catch {}
  } else {
    try { await chrome.storage.local.set({ ...patch, __storeMode: 'local' }); } catch {}
  }
}

// --- rendering ---------------------------------------------------------------
function renderState(settings) {
  if (settings.enabled === false) {
    stateHint.textContent = 'Off. Nothing is blocked, on any site.';
    return;
  }

  const list = activeList(settings);
  const sites = (n) => n + (n === 1 ? ' site' : ' sites');

  if (settings.mode === 'whitelist') {
    stateHint.textContent = list.length
      ? `On ${list.length === 1 ? 'the whitelisted site' : `the ${sites(list.length)} on the whitelist`} only.`
      : 'On, but the whitelist is empty - nothing is blocked yet.';
  } else {
    stateHint.textContent = list.length
      ? `On everywhere except ${sites(list.length)} on the blacklist.`
      : 'On everywhere.';
  }
}

function updateSiteButton(settings) {
  if (!siteHost) {
    siteBtn.disabled = true;
    siteBtn.textContent = 'No website detected';
    hintEl.textContent = 'Open a website to manage it.';
    return;
  }

  siteBtn.disabled = false;
  const listed = inList(activeList(settings), siteHost);
  const whitelist = settings.mode === 'whitelist';
  const verb = whitelist ? 'whitelist' : 'blacklist';

  siteBtn.textContent = listed
    ? `Remove from ${verb}`
    : `${verb[0].toUpperCase() + verb.slice(1)} this site`;

  if (settings.enabled === false) {
    hintEl.textContent = `${siteHost} is on the ${verb}, but the extension is off everywhere.`;
    return;
  }

  // In blacklist mode every site is on unless listed; in whitelist mode only a
  // listed site is. The two read as opposites, which is what they are.
  const on = whitelist ? listed : !listed;
  hintEl.textContent = on
    ? `${siteHost} is ${listed ? 'whitelisted' : 'not blacklisted'} - cast buttons are removed here.`
    : `${siteHost} is ${listed ? 'blacklisted' : 'not whitelisted'} - cast buttons are shown here.`;
}

// The website list box: one row per entry, bin icon to delete.
function renderList(settings) {
  const list = activeList(settings);
  siteListEl.hidden = list.length === 0;
  siteListEl.textContent = '';

  for (const domain of list) {
    const row = document.createElement('div');
    row.className = 'site-row';

    const label = document.createElement('span');
    label.textContent = domain;
    label.title = domain;

    const del = document.createElement('button');
    del.className = 'bin';
    del.title = `Remove ${domain}`;
    del.innerHTML = BIN_SVG;
    del.addEventListener('click', async () => {
      const s = await readSettings();
      const key = s.mode === 'whitelist' ? 'whitelist' : 'blacklist';
      await save({ [key]: s[key].filter((d) => d !== domain) });
      const fresh = await readSettings();
      updateSiteButton(fresh);
      renderList(fresh);
    });

    row.append(label, del);
    siteListEl.append(row);
  }
}

async function render(settings) {
  enabledEl.checked = settings.enabled !== false;
  modeEl.value = settings.mode === 'whitelist' ? 'whitelist' : 'blacklist';
  renderState(settings);
  updateSiteButton(settings);
  renderList(settings);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  siteHost = hostOf(tab?.url);
  await render(await readSettings());
}

// --- events ------------------------------------------------------------------
enabledEl.addEventListener('change', async () => {
  const settings = { ...(await readSettings()), enabled: enabledEl.checked };
  await save({ enabled: enabledEl.checked });
  await render(settings);
});

modeEl.addEventListener('change', async () => {
  await save({ mode: modeEl.value });
  await render(await readSettings());
});

siteBtn.addEventListener('click', async () => {
  if (!siteHost) return;
  const settings = await readSettings();
  const key = settings.mode === 'whitelist' ? 'whitelist' : 'blacklist';
  const list = settings[key].slice();
  const idx = list.indexOf(siteHost);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(siteHost);
  await save({ [key]: list });
  await render(await readSettings());
});

async function addFromInput() {
  const host = normalizeHost(addInput.value);
  if (!host) return;
  const settings = await readSettings();
  const key = settings.mode === 'whitelist' ? 'whitelist' : 'blacklist';
  if (!inList(settings[key], host)) {
    await save({ [key]: [...settings[key], host] });
  }
  addInput.value = '';
  addInput.focus();
  await render(await readSettings());
}

addInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addFromInput();
});

// Another window (or a sync change) may write the settings while this is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' && area !== 'local') return;
  if (changes.enabled || changes.mode || changes.whitelist || changes.blacklist || changes.__storeMode) {
    readSettings().then(render);
  }
});

document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;
init();
