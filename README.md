# Swish Map

Drop-in Mapbox integration for Webflow + Jetboost maps. Handles auto-fitting, sidebar obstruction, popup nudging, desktop hover, and mobile interaction quirks.

## Quick Start

Add this to your Webflow **page-level** custom code (before `</body>`):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/joshuahampson/swish@1.0.0/swish-map.css" />

<script>
  window.__swishMapConfig = {
    maxZoom: 12,
    edgePadding: 48
  };
</script>
<script src="https://cdn.jsdelivr.net/gh/joshuahampson/swish@1.0.0/swish-map.js"></script>
```

> **Tip:** Replace `@1.0.0` with a specific tag to pin a version, or use `@main` for latest (not recommended in production).

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
<script src="https://cdn.jsdelivr.net/gh/joshuahampson/swish@1.0.0/swish-map.js"></script>
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
git tag v1.0.0
git push origin v1.0.0
```

## License

MIT
