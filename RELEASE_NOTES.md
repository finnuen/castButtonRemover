# Release notes

## v1.1

- The `tabs` permission is gone. The popup reads the current site's address from the site access the extension already has, so it no longer asks for a permission it did not use. Nothing else changes; 1.0 and 1.1 behave identically.

## v1.0

First release.

- Cast, Chromecast and AirPlay buttons are removed from every website, including the ones the player draws itself: YouTube, Video.js, JW Player, Shaka, Plyr, Bitmovin, Media Chrome, Jellyfin and others.
- Buttons nobody has taught it yet are recognised by name, label, icon or icon-font glyph, and re-checked as the page changes.
- The Google Cast SDK is blocked before it loads, and the Presentation API and Remote Playback API are disabled, so a page cannot offer casting even if its button is drawn in a canvas or added by a framework.
- The browser's own cast button is stripped from every `<video>` and `<audio>` element, and put back if the page removes the attribute.
- Works inside shadow DOM (open and closed) and inside iframes, before the page paints.
- A toolbar popup with an on/off switch and per-site blacklist or whitelist lists, including subdomains.
- Nothing is collected, stored outside the browser or sent anywhere; the only network effect is the block list.
- An optional Windows policy (`optional-browser-policy/`) removes the browser's own Cast menu entry and toolbar icon as well, which no extension can reach.
