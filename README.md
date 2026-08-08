# Swish Map

Drop-in Mapbox integration for Webflow + Jetboost maps. Handles auto-fitting, sidebar obstruction, popup nudging, desktop hover, and mobile interaction quirks.

## Quick Start

Add this to your Webflow **page-level** custom code (before `</body>`):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/hmpsn/swish@1.0.2/swish-map.css" />

<script>
  window.__swishMapConfig = {
    maxZoom: 12,
    edgePadding: 48
  };
</script>
<script src="https://cdn.jsdelivr.net/gh/hmpsn/swish@1.0.2/swish-map.js"></script>
```

> **Tip:** Replace `@1.0.2` with a specific tag to pin a version, or use `@main` for latest (not recommended in production).

## Configuration

All options are set via `window.__swishMapConfig` before the script loads. Every option has a sensible default — you only need to set what you want to override.

### Selectors

| Option | Default | Description |
|---|---|---|
| `mapSelector` | `'[class*="jetboost-map-"]'` | CSS selector for the Mapbox map container |
| `sidebarSelector` | `'.map_sidebar'` | CSS selector for the sidebar element |
| `listItemSelector` | `'.map_list-new .w-dyn-item[jb-latitude][jb-longitude]'` | CSS selector for Jetboost list items with coordinates |
| `popupSelector` | `'.mapboxgl-popup'` | CSS selector for Mapbox popups |
| `triggerSelector` | `'.jetboost-map-popup-trigger'` | CSS selector for sidebar card click triggers |

### Layout & Zoom

| Option | Default | Description |
|---|---|---|
| `maxZoom` | `12` | Maximum zoom level when auto-fitting bounds |
| `edgePadding` | `48` | Base padding (px) on all sides of the map |
| `gutter` | `48` | Extra gap (px) between sidebar and map content |
| `fitExtraPadding` | `60` | Additional padding (px) added during fit-to-bounds |

### Hover Behavior (Desktop Only)

| Option | Default | Description |
|---|---|---|
| `desktopHoverMQ` | `'(min-width: 992px) and (hover: hover) and (pointer: fine)'` | Media query that enables hover popups |
| `hoverOpenDelay` | `80` | Delay (ms) before opening popup on hover |
| `hoverCloseDelay` | `160` | Delay (ms) before closing popup when mouse leaves |

### Interaction Freeze

| Option | Default | Description |
|---|---|---|
| `clickFreezeMs` | `900` | How long (ms) to suppress auto-fit after a sidebar card click |
| `mapInteractionFreezeMs` | `8000` | How long (ms) to suppress auto-fit after user touches/drags/zooms the map |

### Toggles

| Option | Default | Description |
|---|---|---|
| `disableCanvasFocus` | `true` | Prevent map canvas from stealing focus (fixes mobile scroll-jump) |
| `disableScrollZoomTouch` | `true` | Disable scroll-zoom and drag-rotate on touch devices |

### Lazy Loading (Map Load Billing)

Mapbox bills a "map load" every time `new mapboxgl.Map()` runs in a browser. By default, swish-map defers that call — and the billable load it causes — until the map container actually scrolls into view, instead of firing on every page load whether or not a visitor ever sees the map. A static preview image (via the Mapbox Static Images API, billed on a separate, much cheaper meter) is shown in its place until then.

Everything Jetboost does to the map before it's visible (registering `load` handlers, adding sources/layers, etc.) is queued and replayed on the real map the instant it's created, so functionality is unaffected — visitors who never scroll to the map simply never trigger a load.

| Option | Default | Description |
|---|---|---|
| `lazyLoad` | `true` | Defer real map creation until the container is scrolled into view. Set `false` to restore the old always-load-immediately behavior. |
| `lazyLoadRootMargin` | `'200px 0px 200px 0px'` | `IntersectionObserver` rootMargin — how far before the container enters the viewport to trigger loading. |
| `lazyLoadPreview` | `true` | Show a Mapbox Static Images API preview while waiting to activate. Set `false` for a plain placeholder (no extra static-image requests). |

> **Note:** This only reduces loads for the *initial* map on a page. If Jetboost itself recreates the map (rather than updating markers on the existing instance) on every filter change, each of those still counts as a separate load — check your Mapbox account's Statistics tab (by URL/referrer) to confirm that isn't happening, and consider restricting your Mapbox access token to your production domain(s) under Tokens → URL restrictions if you see loads from unexpected sources.

## Example: Custom Config

```html
<script>
  window.__swishMapConfig = {
    maxZoom: 14,
    edgePadding: 32,
    gutter: 40,
    fitExtraPadding: 50,
    hoverOpenDelay: 100,
    hoverCloseDelay: 200,
    clickFreezeMs: 1200,
    mapInteractionFreezeMs: 5000
  };
</script>
<script src="https://cdn.jsdelivr.net/gh/hmpsn/swish@1.0.2/swish-map.js"></script>
```

## What It Does

- **Auto-fits** map bounds when Jetboost filter results change
- **Freezes auto-fit** after user touches, drags, zooms, or clicks a sidebar card
- **Nudges popups** out from behind the sidebar
- **Desktop hover** opens popups on marker hover (layer-based)
- **Prevents scroll-jump** on mobile when map canvas steals focus
- **Respects `prefers-reduced-motion`** — disables animations for users who prefer it

## Versioning

Tag releases with semver (`v1.0.0`, `v1.1.0`, etc.) so jsDelivr URLs are stable:

```bash
git tag v1.0.2
git push origin v1.0.2
```

> **Warning:** Never delete or move a version tag once it's been pushed. jsDelivr caches tagged-version content as permanently immutable (1-year, `immutable` cache-control) and does **not** re-fetch it on retag — even an explicit cache purge won't fix it. If a tagged release needs a correction, always publish a new version number instead of reusing the old one.

## License

MIT
