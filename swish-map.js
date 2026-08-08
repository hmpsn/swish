/**
 * Swish Map — Drop-in Mapbox integration for Webflow + Jetboost
 * https://github.com/joshuahampson/swish
 *
 * Configure via window.__swishMapConfig before loading this script.
 * See README.md for all options.
 */
(() => {
  // ===========================
  // Swish / Jetboost / Mapbox
  // Full drop-in script
  // ===========================

  const cfg = window.__swishMapConfig || {};

  const MAP_SELECTOR        = cfg.mapSelector       || '[class*="jetboost-map-"]';
  const SIDEBAR_SELECTOR    = cfg.sidebarSelector   || '.map_sidebar';
  const LIST_ITEM_SELECTOR  = cfg.listItemSelector  || '.map_list-new .w-dyn-item[jb-latitude][jb-longitude]';
  const POPUP_SELECTOR      = cfg.popupSelector     || '.mapboxgl-popup';
  const TRIGGER_SELECTOR    = cfg.triggerSelector    || '.jetboost-map-popup-trigger';

  const GUTTER              = cfg.gutter            ?? 48;
  const EDGE_PAD            = cfg.edgePadding       ?? 48;
  const DEFAULT_MAX_ZOOM    = cfg.maxZoom           ?? 12;
  const FIT_EXTRA_PAD       = cfg.fitExtraPadding   ?? 60;

  const DESKTOP_HOVER_MQ    = cfg.desktopHoverMQ    || '(min-width: 992px) and (hover: hover) and (pointer: fine)';
  const MOBILE_SCROLL_TARGET = cfg.mobileScrollTarget || '.map_contain';
  const MOBILE_SCROLL_MQ     = cfg.mobileScrollMQ    || '(max-width: 991px)';
  const HOVER_OPEN_DELAY    = cfg.hoverOpenDelay    ?? 80;
  const HOVER_CLOSE_DELAY   = cfg.hoverCloseDelay   ?? 160;

  const USER_CLICK_FREEZE_MS       = cfg.clickFreezeMs       ?? 900;
  const USER_MAP_INTERACTION_FREEZE_MS = cfg.mapInteractionFreezeMs ?? 8000;

  const LAZY_LOAD            = cfg.lazyLoad          ?? true;
  const LAZY_ROOT_MARGIN     = cfg.lazyLoadRootMargin || '200px 0px 200px 0px';
  const LAZY_PREVIEW         = cfg.lazyLoadPreview    ?? true;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function motionDuration(ms) { return prefersReducedMotion ? 0 : ms; }

  let suppressAutoFitUntil = 0;

  let fitTimer = null;
  let fitJobId = 0;
  let lastResultsSig = '';

  // ---------------------------
  // Helpers
  // ---------------------------
  function isDesktopHover() {
    return window.matchMedia(DESKTOP_HOVER_MQ).matches;
  }

  function freezeAutoFit(ms) {
    suppressAutoFitUntil = Date.now() + ms;
    fitJobId++;
    if (fitTimer) {
      clearTimeout(fitTimer);
      fitTimer = null;
    }
  }

  function getMap() {
    const map = window.__swishJetboostMap;
    if (!map) return null;
    try { map.getCenter(); return map; } catch (e) { return null; }
  }

  function disableCanvasFocus(map) {
    if (!map || map.__swishCanvasFocusDisabled) return;
    map.__swishCanvasFocusDisabled = true;

    const canvas = map.getCanvas?.();
    if (!canvas) return;

    canvas.setAttribute("tabindex", "-1");
    canvas.style.outline = "none";

    try { map.keyboard?.disable?.(); } catch (e) {}

    canvas.addEventListener("focus", () => {
      canvas.blur();
    }, true);
  }

  function getMapEl() {
    return document.querySelector(MAP_SELECTOR);
  }

  function rectsOverlap(a, b) {
    return (
      b.bottom > a.top &&
      b.top < a.bottom &&
      b.right > a.left &&
      b.left < a.right
    );
  }

  function getObstructionSide(mapRect, sideRect) {
    if (!rectsOverlap(mapRect, sideRect)) return null;

    const distances = [
      { side: 'left',   d: Math.abs(sideRect.right - mapRect.left) },
      { side: 'right',  d: Math.abs(mapRect.right - sideRect.left) },
      { side: 'top',    d: Math.abs(sideRect.bottom - mapRect.top) },
      { side: 'bottom', d: Math.abs(mapRect.bottom - sideRect.top) }
    ];

    distances.sort((a, b) => a.d - b.d);
    return distances[0].side;
  }

  // ---------------------------
  // 1) Padding
  // ---------------------------
  function computePadding() {
    const mapEl = getMapEl();
    const sidebarEl = document.querySelector(SIDEBAR_SELECTOR);

    const base = { top: EDGE_PAD, right: EDGE_PAD, bottom: EDGE_PAD, left: EDGE_PAD };
    if (!mapEl || !sidebarEl) return base;

    const mapRect = mapEl.getBoundingClientRect();
    const sideRect = sidebarEl.getBoundingClientRect();

    const obstructionSide = getObstructionSide(mapRect, sideRect);
    if (!obstructionSide) return base;

    if (obstructionSide === 'left')   return { ...base, left: base.left + Math.round(sideRect.width + GUTTER) };
    if (obstructionSide === 'right')  return { ...base, right: base.right + Math.round(sideRect.width + GUTTER) };
    if (obstructionSide === 'top')    return { ...base, top: base.top + Math.round(sideRect.height + GUTTER) };
    if (obstructionSide === 'bottom') return { ...base, bottom: base.bottom + Math.round(sideRect.height + GUTTER) };

    return base;
  }

  function applyPadding(map) {
    map.setPadding(computePadding());
    map.resize();
  }

  // ---------------------------
  // 2) Fit bounds
  // ---------------------------
  function isVisible(el) {
    return !!(el && el.getClientRects().length && getComputedStyle(el).display !== 'none');
  }

  function getVisiblePoints() {
    const items = Array.from(document.querySelectorAll(LIST_ITEM_SELECTOR)).filter(isVisible);
    return items
      .map(el => {
        const lat = parseFloat(el.getAttribute('jb-latitude'));
        const lng = parseFloat(el.getAttribute('jb-longitude'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng };
      })
      .filter(Boolean);
  }

  function getResultsSignature() {
    const pts = getVisiblePoints();
    return pts
      .map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
      .sort()
      .join('|');
  }

  function fitToVisibleMarkers(map, { maxZoom = DEFAULT_MAX_ZOOM, duration = 450 } = {}) {
    const pts = getVisiblePoints();
    if (!pts.length) return;

    const d = motionDuration(duration);

    const padding = computePadding();
    padding.top += FIT_EXTRA_PAD;
    padding.right += FIT_EXTRA_PAD;
    padding.bottom += FIT_EXTRA_PAD;
    padding.left += FIT_EXTRA_PAD;

    if (pts.length === 1) {
      map.easeTo({
        center: [pts[0].lng, pts[0].lat],
        zoom: maxZoom,
        padding,
        duration: d
      });
      return;
    }

    const b = new mapboxgl.LngLatBounds([pts[0].lng, pts[0].lat], [pts[0].lng, pts[0].lat]);
    for (let i = 1; i < pts.length; i++) b.extend([pts[i].lng, pts[i].lat]);

    map.fitBounds(b, { padding, maxZoom, duration: d });
  }

  function scheduleFit(map, { force = false, duration = 450 } = {}) {
    if (!map) return;
    if (Date.now() < suppressAutoFitUntil) return;

    const sig = getResultsSignature();
    if (!force && sig === lastResultsSig) return;

    lastResultsSig = sig;

    if (fitTimer) clearTimeout(fitTimer);
    const myJob = ++fitJobId;

    fitTimer = setTimeout(() => {
      if (myJob !== fitJobId) return;
      if (Date.now() < suppressAutoFitUntil) return;

      const run = () => {
        if (Date.now() < suppressAutoFitUntil) return;
        fitToVisibleMarkers(map, { duration });
      };

      if (map.isMoving && map.isMoving()) {
        map.once('idle', run);
      } else {
        run();
      }
    }, 60);
  }

  // ---------------------------
  // 2.5) Nudge popups into view
  // ---------------------------
  function getLatestPopupEl() {
    const popups = Array.from(document.querySelectorAll(POPUP_SELECTOR));
    return popups.length ? popups[popups.length - 1] : null;
  }

  function nudgePopupIntoView(map, attempt = 0, targetEl = null) {
    const mapEl = getMapEl();
    const sidebarEl = document.querySelector(SIDEBAR_SELECTOR);
    const popupEl = targetEl || getLatestPopupEl();

    if (!map || !mapEl || !sidebarEl || !popupEl || !popupEl.isConnected) return;

    const mapRect = mapEl.getBoundingClientRect();
    const sideRect = sidebarEl.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();

    const obstructionSide = getObstructionSide(mapRect, sideRect);
    if (!obstructionSide) return;
    if (!rectsOverlap(popupRect, sideRect)) return;

    let shiftPopupX = 0;
    let shiftPopupY = 0;

    if (obstructionSide === 'left') {
      const minLeft = sideRect.right + GUTTER;
      if (popupRect.left < minLeft) shiftPopupX = (minLeft - popupRect.left);
    } else if (obstructionSide === 'right') {
      const maxRight = sideRect.left - GUTTER;
      if (popupRect.right > maxRight) shiftPopupX = -(popupRect.right - maxRight);
    } else if (obstructionSide === 'top') {
      const minTop = sideRect.bottom + GUTTER;
      if (popupRect.top < minTop) shiftPopupY = (minTop - popupRect.top);
    } else if (obstructionSide === 'bottom') {
      const maxBottom = sideRect.top - GUTTER;
      if (popupRect.bottom > maxBottom) shiftPopupY = -(popupRect.bottom - maxBottom);
    }

    if (!shiftPopupX && !shiftPopupY) return;

    const center = map.getCenter();
    const centerPx = map.project(center);
    const nextCenterPx = centerPx.clone();
    nextCenterPx.x -= shiftPopupX;
    nextCenterPx.y -= shiftPopupY;

    const nextCenter = map.unproject(nextCenterPx);
    map.easeTo({ center: nextCenter, duration: motionDuration(250) });

    if (attempt < 2) {
      map.once('moveend', () => requestAnimationFrame(() => nudgePopupIntoView(map, attempt + 1, popupEl)));
    }
  }

  function watchForPopups(map) {
    const mapEl = getMapEl();
    if (!mapEl) return;

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes || []) {
          if (node.nodeType === 1 && (node.matches?.(POPUP_SELECTOR) || node.querySelector?.(POPUP_SELECTOR))) {
            const run = () => requestAnimationFrame(() => nudgePopupIntoView(map));
            if (map.isMoving()) map.once('moveend', run);
            else run();
            return;
          }
        }
      }
    });

    observer.observe(mapEl, { childList: true, subtree: true });
  }

  // ---------------------------
  // 2.8) Freeze auto-fit on user interaction
  // ---------------------------
  function bindUserInteractionFreeze(map) {
    if (!map || map.__swishUserFreezeBound) return;
    map.__swishUserFreezeBound = true;

    const freeze = () => freezeAutoFit(USER_MAP_INTERACTION_FREEZE_MS);

    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach(evt => map.on(evt, freeze));

    const canvas = map.getCanvas?.();
    if (canvas) {
      canvas.addEventListener('touchstart', freeze, { passive: true });
      canvas.addEventListener('wheel', freeze, { passive: true });
      canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') freeze();
      }, { passive: true });
    }

    // Only disable scroll-zoom & drag-rotate on touch devices
    if (!isDesktopHover()) {
      try {
        map.scrollZoom?.disable?.();
        map.dragRotate?.disable?.();
        map.touchZoomRotate?.disableRotation?.();
      } catch (e) {}
    }
  }

  // Sidebar card click: freeze auto-fit; on mobile/tablet scroll to map container
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest(TRIGGER_SELECTOR);
    if (!trigger) return;

    freezeAutoFit(USER_CLICK_FREEZE_MS);

    if (window.matchMedia(MOBILE_SCROLL_MQ).matches) {
      const scrollTarget = document.querySelector(MOBILE_SCROLL_TARGET);
      if (scrollTarget) {
        requestAnimationFrame(() => {
          scrollTarget.scrollIntoView({ behavior: prefersReducedMotion ? 'instant' : 'smooth', block: 'start' });
        });
        return;
      }
    }

    const scrollY = window.scrollY;
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
    });
  }, true);

  // ---------------------------
  // 3) Desktop hover opens popup
  // ---------------------------
  function closeAllPopups() {
    document.querySelectorAll(POPUP_SELECTOR).forEach(p => {
      const btn = p.querySelector('.mapboxgl-popup-close-button');
      if (btn) btn.click();
      else p.remove();
    });
  }

  function getInteractiveLayerIds(map) {
    const style = map.getStyle?.();
    const layers = style?.layers || [];
    const sources = style?.sources || {};

    const ids = [];
    if (layers.some(l => l.id === 'xk2x')) ids.push('xk2x');

    for (const l of layers) {
      if (!l.source) continue;
      if (l.source === 'composite') continue;
      if (!sources[l.source]) continue;
      if (!ids.includes(l.id)) ids.push(l.id);
    }

    return ids;
  }

  function setupDesktopHover(map) {
    if (map.__swishHoverSetup) return;
    map.__swishHoverSetup = true;

    let interactiveLayers = [];
    let lastKey = null;
    let openT = null;
    let closeT = null;
    let moveRAF = null;

    const refreshLayers = () => { interactiveLayers = getInteractiveLayerIds(map); };
    refreshLayers();
    map.on('styledata', refreshLayers);

    const mapEl = getMapEl();

    const cancelClose = () => { if (closeT) clearTimeout(closeT); closeT = null; };
    const scheduleClose = () => {
      cancelClose();
      if (openT) clearTimeout(openT);
      openT = null;

      closeT = setTimeout(() => {
        if (!isDesktopHover()) return;
        closeAllPopups();
        lastKey = null;
      }, HOVER_CLOSE_DELAY);
    };

    const scheduleOpen = (e, key) => {
      cancelClose();
      if (openT) clearTimeout(openT);

      openT = setTimeout(() => {
        if (!isDesktopHover()) return;

        closeAllPopups();

        const originalEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        map.fire('click', { point: e.point, lngLat: e.lngLat, originalEvent });

        const run = () => requestAnimationFrame(() => nudgePopupIntoView(map));
        if (map.isMoving()) map.once('moveend', run);
        else run();
      }, HOVER_OPEN_DELAY);
    };

    const handleHoverMove = (e) => {
      if (!isDesktopHover()) return;

      const overPopup = mapEl && document.elementFromPoint(e.originalEvent.clientX, e.originalEvent.clientY)?.closest?.(POPUP_SELECTOR);
      if (overPopup) {
        cancelClose();
        return;
      }

      if (!interactiveLayers.length) {
        scheduleClose();
        return;
      }

      const feats = map.queryRenderedFeatures(e.point, { layers: interactiveLayers });
      const f = feats && feats[0];

      if (!f) {
        scheduleClose();
        return;
      }

      // Reliable feature key — fall back to geometry, not mouse position
      const key =
        (f.id != null ? `id:${f.id}` : null) ||
        (f.properties?.id   ? `p:${f.properties.id}`   : null) ||
        (f.properties?.slug ? `p:${f.properties.slug}` : null) ||
        (f.properties?.name ? `p:${f.properties.name}` : null) ||
        (f.geometry?.coordinates
          ? `geo:${JSON.stringify(f.geometry.coordinates)}`
          : `xy:${Math.round(e.point.x)}:${Math.round(e.point.y)}`);

      if (key === lastKey) {
        cancelClose();
        return;
      }

      lastKey = key;
      scheduleOpen(e, key);
    };

    // Throttled mousemove via rAF
    map.on('mousemove', (e) => {
      if (moveRAF) return;
      moveRAF = requestAnimationFrame(() => {
        moveRAF = null;
        handleHoverMove(e);
      });
    });

    if (mapEl) {
      mapEl.addEventListener('mouseleave', () => {
        if (!isDesktopHover()) return;
        scheduleClose();
      });

      mapEl.addEventListener('mouseenter', (evt) => {
        if (!isDesktopHover()) return;
        if (evt.target?.closest?.(POPUP_SELECTOR)) cancelClose();
      }, true);

      mapEl.addEventListener('mouseover', (evt) => {
        if (!isDesktopHover()) return;
        if (evt.target?.closest?.(POPUP_SELECTOR)) cancelClose();
      }, true);

      mapEl.addEventListener('mouseout', (evt) => {
        if (!isDesktopHover()) return;
        const related = evt.relatedTarget;
        if (evt.target?.closest?.(POPUP_SELECTOR) && (!related || !related.closest?.(POPUP_SELECTOR))) {
          scheduleClose();
        }
      }, true);
    }
  }

  // ---------------------------
  // 3.5) Lazy-load: defer the real (billable) mapboxgl.Map()
  //      call until the map container is actually visible.
  // ---------------------------
  const activatedContainers = new WeakSet();

  // Methods that mutate/subscribe and are safe to queue + replay in order
  // once the real map exists. Mapbox GL requires addSource/addLayer/getSource
  // etc. to happen after 'load'/'style.load' fires anyway, so in practice
  // these are almost always called from inside a queued 'on'/'once' callback,
  // which itself only runs once the real map is live (see activate() below).
  const LAZY_QUEUEABLE_METHODS = [
    'on', 'once', 'off',
    'addSource', 'removeSource',
    'addLayer', 'removeLayer', 'moveLayer',
    'setLayoutProperty', 'setPaintProperty', 'setFilter',
    'addControl', 'removeControl',
    'setCenter', 'setZoom', 'jumpTo', 'easeTo', 'flyTo', 'fitBounds', 'panTo',
    'setPadding', 'setMaxZoom', 'setMinZoom', 'setStyle',
    'resize', 'triggerRepaint'
  ];

  function resolveAccessToken(options) {
    return options?.accessToken || window.mapboxgl.accessToken || null;
  }

  function normalizeStyleForStatic(style) {
    if (typeof style === 'string') {
      const m = style.match(/^mapbox:\/\/styles\/([^/]+)\/([^/?#]+)/);
      if (m) return `${m[1]}/${m[2]}`;
    }
    return 'mapbox/streets-v12';
  }

  function buildStaticPreviewUrl(container, options) {
    try {
      const token = resolveAccessToken(options);
      if (!token) return null;

      const styleId = normalizeStyleForStatic(options?.style);

      let center = Array.isArray(options?.center) ? options.center : null;
      if (!center) {
        const pts = getVisiblePoints();
        if (pts.length) {
          const avgLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
          const avgLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
          center = [avgLng, avgLat];
        }
      }
      if (!center) return null;

      const zoom = Number.isFinite(options?.zoom) ? options.zoom : 9;

      const rect = container.getBoundingClientRect();
      const w = Math.max(64, Math.min(1280, Math.round(rect.width) || 640));
      const h = Math.max(64, Math.min(1280, Math.round(rect.height) || 480));

      const lng = center[0].toFixed(5);
      const lat = center[1].toFixed(5);
      const z = Math.max(0, Math.min(20, zoom)).toFixed(2);

      return `https://api.mapbox.com/styles/v1/${styleId}/static/${lng},${lat},${z}/${w}x${h}@2x?access_token=${encodeURIComponent(token)}`;
    } catch (e) {
      return null;
    }
  }

  function createLazyPlaceholder(container, options) {
    const el = document.createElement('div');
    el.className = 'swish-map-lazy-placeholder';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'absolute',
      inset: '0',
      backgroundColor: '#e9e5df',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      transition: motionDuration(200) ? 'opacity 200ms ease' : 'none',
      pointerEvents: 'none'
    });

    if (LAZY_PREVIEW) {
      const url = buildStaticPreviewUrl(container, options);
      if (url) {
        const img = new Image();
        img.onload = () => { el.style.backgroundImage = `url("${url}")`; };
        img.src = url;
      }
    }

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    container.appendChild(el);
    return el;
  }

  // Wraps mapboxgl.Map so the real (billable) instance isn't created until
  // `container` scrolls into view. Everything Jetboost does to the returned
  // proxy before that point is queued and replayed, in order, on the real
  // map the moment it's created. After activation the proxy transparently
  // forwards to the real map forever, so Jetboost's original reference keeps
  // working for the life of the page.
  function makeLazyMap(container, options, OriginalMap) {
    let realMap = null;
    let dummyCanvas = null;
    const queue = [];

    const proxy = new Proxy({}, {
      get(_target, prop) {
        if (realMap) {
          const val = realMap[prop];
          return typeof val === 'function' ? val.bind(realMap) : val;
        }

        switch (prop) {
          case '__swishLazyProxy': return true;
          case 'loaded':
          case 'isStyleLoaded':
          case 'isMoving':
          case 'isZooming':
          case 'isRotating':
            return () => false;
          case 'getContainer':
            return () => container;
          case 'getCanvas':
            return () => (dummyCanvas || (dummyCanvas = document.createElement('canvas')));
          case 'getCenter': {
            const c = Array.isArray(options?.center) ? options.center : [0, 0];
            return () => ({ lng: c[0], lat: c[1] });
          }
          case 'getZoom': {
            const z = Number.isFinite(options?.zoom) ? options.zoom : 0;
            return () => z;
          }
          case 'getStyle':
            return () => ({ layers: [], sources: {} });
          case 'getPadding':
            return () => ({ top: 0, right: 0, bottom: 0, left: 0 });
          case 'remove':
            return () => { disconnect(); };
        }

        if (LAZY_QUEUEABLE_METHODS.includes(prop)) {
          return (...args) => { queue.push({ method: prop, args }); return proxy; };
        }

        // Unknown API surface called before activation: no-op rather than throw.
        return (...args) => proxy;
      },
      set(_target, prop, value) {
        if (realMap) { realMap[prop] = value; }
        return true;
      },
      has(_target, prop) {
        return realMap ? (prop in realMap) : true;
      }
    });

    let io = null;
    const disconnect = () => { if (io) { io.disconnect(); io = null; } };

    const placeholder = createLazyPlaceholder(container, options);

    function activate() {
      if (realMap) return;
      disconnect();
      activatedContainers.add(container);

      let map;
      try {
        map = new OriginalMap(options);
        for (const { method, args } of queue) {
          try { map[method](...args); } catch (e) {}
        }
      } catch (e) {
        console.error('[swish-map] lazy map activation failed, falling back', e);
        if (placeholder.parentNode) placeholder.remove();
        return;
      }

      realMap = map; // proxy now forwards everything live, from here on

      if (placeholder.parentNode) {
        placeholder.style.opacity = '0';
        setTimeout(() => placeholder.remove(), motionDuration(200) + 20);
      }

      window.__swishJetboostMap = map;

      const run = () => {
        applyPadding(map);
        lastResultsSig = getResultsSignature();
        scheduleFit(map, { force: true, duration: 0 });
        watchForPopups(map);
        bindUserInteractionFreeze(map);
        disableCanvasFocus(map);
        setupDesktopHover(map);
      };

      if (map.loaded()) run();
      else map.once('load', run);
    }

    io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { activate(); break; }
      }
    }, { root: null, rootMargin: LAZY_ROOT_MARGIN, threshold: 0.01 });

    io.observe(container);

    return proxy;
  }

  // ---------------------------
  // 4) Capture Jetboost's Mapbox instance
  // ---------------------------
  function patchMapbox() {
    if (!window.mapboxgl || !window.mapboxgl.Map || window.__swishMapboxPatched) return;
    window.__swishMapboxPatched = true;

    const OriginalMap = window.mapboxgl.Map;

    function PatchedMap(options) {
      const container =
        typeof options?.container === 'string'
          ? document.getElementById(options.container)
          : options?.container;

      const isTarget = !!(container && container.matches && container.matches(MAP_SELECTOR));

      if (LAZY_LOAD && isTarget && !activatedContainers.has(container)) {
        try {
          return makeLazyMap(container, options, OriginalMap);
        } catch (e) {
          console.error('[swish-map] lazy-load setup failed, loading map immediately', e);
          // fall through to the immediate path below
        }
      }

      const map = new OriginalMap(options);

      try {
        if (isTarget) {
          window.__swishJetboostMap = map;

          const run = () => {
            applyPadding(map);
            lastResultsSig = getResultsSignature();
            scheduleFit(map, { force: true, duration: 0 });
            watchForPopups(map);
            bindUserInteractionFreeze(map);
            disableCanvasFocus(map);
            setupDesktopHover(map);
          };

          if (map.loaded()) run();
          else map.once('load', run);
        }
      } catch (e) {}

      return map;
    }

    PatchedMap.prototype = OriginalMap.prototype;
    Object.setPrototypeOf(PatchedMap, OriginalMap);
    window.mapboxgl.Map = PatchedMap;
  }

  let patchAttempts = 0;
  const patchTimer = setInterval(() => {
    patchMapbox();
    if (window.__swishMapboxPatched || ++patchAttempts > 200) clearInterval(patchTimer);
  }, 50);

  // ---------------------------
  // 5) Re-run on Jetboost changes
  // ---------------------------
  function rerun({ forceFit = false, duration = 450 } = {}) {
    const map = getMap();
    if (!map) return;

    requestAnimationFrame(() => {
      applyPadding(map);

      if (Date.now() < suppressAutoFitUntil) {
        nudgePopupIntoView(map);
        return;
      }

      scheduleFit(map, { force: forceFit, duration });
      nudgePopupIntoView(map);
    });
  }

  const prev = window.JetboostListUpdated;
  window.JetboostListUpdated = function (collectionList) {
    try { if (typeof prev === 'function') prev(collectionList); }
    finally { rerun({ forceFit: true, duration: 450 }); }
  };

  // MutationObserver: bail early if the point set hasn't actually changed
  const mo = new MutationObserver(() => {
    const sig = getResultsSignature();
    if (sig === lastResultsSig) return;
    rerun({ forceFit: false, duration: 450 });
  });
  function watchList() {
    const list = document.querySelector('.map_list-new');
    if (list) mo.observe(list, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchList);
  else watchList();

  // Debounced resize
  let resizeT = null;
  window.addEventListener('resize', () => {
    if (resizeT) clearTimeout(resizeT);
    resizeT = setTimeout(() => rerun({ forceFit: false, duration: 0 }), 150);
  });
})();
