# AGENTS.md

Guide for anyone (human or AI agent) modifying **castButtonRemover**. Read this before changing code.

## What this is

A Manifest V3 Chromium extension that makes casting impossible on every page: it blocks the Google Cast SDK, removes the page-level cast APIs, strips the browser's own cast button from media controls, hides known cast buttons before first paint, and recognises unknown ones by name, label or icon.

It runs in **every frame of every site**, including inside open and closed shadow DOM — except where the popup has switched it off or the site is on a list.

## Files

| File | Role |
| --- | --- |
| `extension/manifest.json` | MV3 definition: permissions, action popup, service worker, icons. Holds the version |
| `extension/background.js` | Service worker. Reads the settings and **decides what to inject**: registers the three content scripts for matching sites (or none), and writes the dynamic block rules with the site list as `initiatorDomains` / `excludedInitiatorDomains` |
| `extension/popup.html` | Popup markup: the switch, the site-list mode select, the add box, the list |
| `extension/popup.css` | Popup styling, matching `seekBar`'s |
| `extension/popup.js` | Popup logic. Reads and writes `chrome.storage.sync` (falling back to `local` when sync refuses a write), renders the list and the per-page hint |
| `extension/content/hide.css` | **The hide rules. Single source** — the known selectors, the label/title selectors, `[data-nocast="1"]` |
| `extension/content/main-world.js` | Page world. Removes the Presentation API, hardens Remote Playback, forces `disableremoteplayback`, patches `attachShadow`, answers `__onGCastApiAvailable` with "not available". Carries `CSS_TEXT`, a verbatim copy of `hide.css` for shadow roots |
| `extension/content/dom-guard.js` | Extension world. Hides known and unknown buttons, walks open and closed shadow roots, keeps media attributes on, rescans on mutation and on a timer (sliced into 8 ms chunks). Carries `KNOWN`, the selector list generated from `hide.css` |
| `extension/icons/icon-{16,32,48,128}.png` | Rendered from `assets/icon.svg` |
| `assets/icon.svg` | Icon source: red prohibition ring. Edit here, then re-render the PNGs |
| `optional-browser-policy/*.reg` | Optional Windows policy that also removes the browser's own Cast menu and icon |
| `tools/hide-rules.js` | Regenerates `CSS_TEXT` and `KNOWN` from `content/hide.css`; `--check` reports drift |
| `tools/make-key.js` | Creates `key.pem` on first build |
| `tools/build.ps1` | Runs `hide-rules.js`, then writes `build/castButtonRemover_v<version>.zip` and `.crx` |
| `README.md` | User-facing docs |
| `RELEASE_NOTES.md` | One section per release |

No bundler, no dependency, no test framework. `extension/` is loaded as-is.

## The five layers, and where each lives

1. **Network** — `background.js`, `networkRules()`. Four `urlFilter`s block the Cast sender scripts. The rules are **dynamic**, not a static ruleset, because the site list has to travel with them (see the gating rule below).
2. **Page APIs** — `main-world.js`, sections 1, 2 and 5. `PresentationRequest` is deleted, `navigator.presentation` becomes `undefined`, `RemotePlayback.watchAvailability()`/`prompt()` reject, and `__onGCastApiAvailable` is wrapped so a page is always told `false`.
3. **Media elements** — both scripts. `main-world.js` forces the `disableRemotePlayback` property to `true` and keeps `disableremoteplayback` + `controlslist=noremoteplayback` on every `<video>`/`<audio>` via a `MutationObserver`; `dom-guard.js` does the same from the extension world, so a page that strips the attributes gets them back even if the page world is interfered with.
4. **Stylesheet** — `content/hide.css`, injected as a content-script stylesheet (every frame, light DOM) and, through `main-world.js` `CSS_TEXT`, adopted into every shadow root the page creates.
5. **Detector** — `dom-guard.js`. Known selectors from `KNOWN`, then attribute, icon and visible-text classification with confidence levels:
   - `2` certain — a strong label ("Cast to device", "AirPlay"), a strong token (`chromecast-button`, `castButton`), an icon class or ligature, an SVG `<use href="#cast">`, the Material cast path;
   - `1` probable — `cast` next to a control word (`cast-button`), a custom element with `cast` in its name;
   - `0.5` weak — the bare word `cast`, or `aria-label="Cast"`.

   A match is accepted when it is certain, when it is probable and has no text, or when anything weaker sits inside a video player.

## Gating: the worker injects, the page never gates itself

The content scripts are **registered by `background.js`**, not declared in the manifest. This is the rule that makes the switch and the site lists work, and it must not be traded for a storage read inside a script:

- Content scripts run at `document_start`, while `chrome.storage` answers asynchronously. A manifest-declared script that asks "am I enabled here?" and waits for the answer has already patched `navigator.presentation` for a page it should have left alone. Registration is decided by the browser *before* the page runs, so an off site gets nothing at all.
- The network layer follows the same rule. A static ruleset cannot express "everywhere except these domains", and in whitelist mode it would block sites that were never listed; so the rules are written dynamically from the settings. `initiatorDomains` is the whitelist, `excludedInitiatorDomains` the blacklist.
- `apply()` runs on install, on browser start, on any settings change and once whenever the worker wakes. It is serialised through one promise chain: two overlapping applies would unregister what the other just registered.
- **`updateContentScripts()` only replaces the properties it is given.** `excludeMatches` is therefore always sent, `[]` included — omit it and switching back to whitelist keeps the blacklist's exclusions, and a listed site is both matched and excluded (excluded wins, so it is silently left unguarded).
- Dynamic content scripts are cleared by an extension update; `onInstalled` re-applies them, which is why that event is wired up and not just `onStartup`.

## Design rules (don't break these)

1. **Hide, never remove.** `display: none !important` plus `data-nocast="1"`; a framework that manages the node (React, Vue) must never see it disappear.
2. **Never break the page.** Every step in `main-world.js` and every scan path in `dom-guard.js` is wrapped so an error cannot reach page script. The page world gets no `chrome.*` access — verified.
3. **Stay below the label.** A control whose only hint is the bare word "Cast" is left alone outside a player: casting spells, a cast list and "Cast" a playlist are all real. False positives are worse than a missed button.
4. **No network, no storage, no messaging** on the page side. The only network effect is the block list. No `chrome.storage` in a content script, no `fetch`, no analytics, no remote code. Settings live in `chrome.storage.sync` and are read by the worker and the popup only.
5. **One source for the hide rules.** `content/hide.css` is edited by hand; `CSS_TEXT` and `KNOWN` are generated by `tools/hide-rules.js` and the build regenerates them. Never edit the generated lines; if `node tools/hide-rules.js --check` fails, run it without `--check`.
   The `KNOWN` derivation skips `[data-nocast="1"]` and generic `button[...]` / `[role="button"]` selectors, which the stylesheet already covers and which must not be matched on the element alone.
6. **document_start, before page script.** The `attachShadow` patch only catches roots created after it, which is why the main-world script is registered first in the array and why the deep sweep at 1.5 s exists for declarative roots.
7. **Minimal permissions.** `declarativeNetRequest`, `scripting`, `storage` and `host_permissions: <all_urls>`. `scripting` is what registers the scripts; `host_permissions` is what lets the popup read the current tab's URL, which is why `tabs` is **not** declared — `chrome.tabs.query` itself needs no permission, only the `url` property does, and the host grant already provides it. Adding another permission needs to be justified in the README.

## Keeping things in sync

- **A new known cast button:** add its selector to `extension/content/hide.css`, then run the build (or `node tools/hide-rules.js`). It reaches the light DOM, every shadow root and `KNOWN` from that one line.
- **A new blocked script:** add its `urlFilter` to `BLOCKED` in `background.js`; `RULE_IDS` derives the ids, so there is nothing to renumber.
- **The generated marker:** `data-nocast` (attribute), `nocast:shadow` (event) and `Symbol.for('nocast.main.v1')` are internal names; renaming them is a cross-file change with no user-visible benefit.
- **Icon change:** edit `assets/icon.svg` and re-render 16/32/48/128 px PNGs into `extension/icons/`, keeping the `icon-<size>.png` names `manifest.json` expects. Render from the SVG, never upscale a small PNG.
- **A new layer or API:** `main-world.js` (page world) plus a note in the README's "What it does" list.

## Testing

Load `extension/` from `chrome://extensions` (Developer mode, *Load unpacked*) and open a page with a video. The README's console probe must print `[true, 'undefined', false]`; with the switch off or the site listed, it must print `[false, 'function', true]`.

There is no committed automated test. A throwaway harness can load the unpacked extension into headless Edge over CDP and check both halves: the layers on a page full of cast buttons and decoys, and the gate (registered scripts and dynamic rules for each combination of switch, mode and list, with a page on each side of the list). That is worth doing after a change to `main-world.js`, `dom-guard.js` or `background.js`, and after a build, because it is the packaged copy that ships.

Two things cost time if forgotten: the worker registers a moment after the browser starts, so a page created immediately gets nothing (wait, then navigate); and Edge runs its own service workers, so pick the extension's by `chrome.runtime.getManifest().name`, not by being the first one in the target list.

## Releasing

1. Bump `version` in `extension/manifest.json` — plain `major.minor`, e.g. `1.1`.
2. Add a section to `RELEASE_NOTES.md`.
3. Build:
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\build.ps1
   ```
   This writes `build/castButtonRemover_v1.1.zip` and `build/castButtonRemover_v1.1.crx`.
4. Tag with the bare version, no `v`: `git tag -a 1.1 -m "castButtonRemover 1.1"`.
5. Attach both files to the release under the unversioned names `castButtonRemover.zip` and `castButtonRemover.crx`, and nothing else. The zip root is the folder `castButtonRemover`, so unzipping gives a folder to point *Load unpacked* at.
6. Title the release `castButtonRemover v1.1`; body = that version's bullets from `RELEASE_NOTES.md`.

`key.pem` fixes the extension ID: a different key is a different extension, and installed copies would not update. It is gitignored and created by the first build — keep a backup outside the repository.

## Known limitations

- Canvas-only players with no `<video>` element are out of reach.
- A probable match is hidden only when it holds no text, and `norm()` trims `\s` but not zero-width characters, so an icon button whose only content is U+200B is missed. Fix if it ever shows up in the wild by stripping `[\u200b-\u200f\u2060\ufeff]` in `norm()`.
- A control whose only hint is the bare word "Cast" (`aria-label="Cast"`, no class, no player around it) stays visible by design (rule 3).
- A page that is already open keeps whatever it started with: switching the extension off, or adding the site to a list, takes effect on the next load, not in the open tab.
- The first page after an install (or after the browser starts with pages already queued) can load before the worker has registered the scripts. It is protected from the next load on; the switch and the lists are unaffected because they are read from storage each time the worker applies them.
- The page's own console shows `net::ERR_BLOCKED_BY_CLIENT` for every blocked Cast script. That is the block working; it is not a fault.
- `remote.prompt()` on a site that had already captured a `RemotePlayback` before the patch would still be its own object; the patch replaces the prototype methods at `document_start`, so this only matters for a pre-existing realm.
- Closed shadow roots are reached through `chrome.dom.openOrClosedShadowRoot`; a root created before the patch and never announced is only found by the 1.5 s deep sweep.
