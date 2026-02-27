/**
 * Swish Map — Drop-in Mapbox integration for Webflow + Jetboost
 * https://github.com/joshuahampson/swish
 *
 * Configure via window.__swishMapConfig before loading this script.
 * See README.md for all options.
 */
(() => {
  const cfg = window.__swishMapConfig || {};

  // ---------------------------
  // Configurable constants
  // ---------------------------
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
  const HOVER_OPEN_DELAY    = cfg.hoverOpenDelay    ?? 80;
  const HOVER_CLOSE_DELAY   = cfg.hoverCloseDelay   ?? 160;

  const USER_CLICK_FREEZE_MS       = cfg.clickFreezeMs       ?? 900;
  const USER_MAP_INTERACTION_FREEZE_MS = cfg.mapInteractionFreezeMs ?? 8000;

  const DISABLE_CANVAS_FOCUS = cfg.disableCanvasFocus ?? true;
  const DISABLE_SCROLL_ZOOM_TOUCH = cfg.disableScrollZoomTouch ?? true;

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
    var map = window.__swishJetboostMap;
    if (!map) return null;
    try { map.getCenter(); return map; } catch (e) { return null; }
  }

  function disableCanvasFocusFn(map) {
    if (!DISABLE_CANVAS_FOCUS) return;
    if (!map || map.__swishCanvasFocusDisabled) return;
    map.__swishCanvasFocusDisabled = true;

    var canvas = map.getCanvas && map.getCanvas();
    if (!canvas) return;

    canvas.setAttribute('tabindex', '-1');
    canvas.style.outline = 'none';

    try { if (map.keyboard && map.keyboard.disable) map.keyboard.disable(); } catch (e) {}

    canvas.addEventListener('focus', function () {
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

    var distances = [
      { side: 'left',   d: Math.abs(sideRect.right - mapRect.left) },
      { side: 'right',  d: Math.abs(mapRect.right - sideRect.left) },
      { side: 'top',    d: Math.abs(sideRect.bottom - mapRect.top) },
      { side: 'bottom', d: Math.abs(mapRect.bottom - sideRect.top) }
    ];

    distances.sort(function (a, b) { return a.d - b.d; });
    return distances[0].side;
  }

  // ---------------------------
  // 1) Padding
  // ---------------------------
  function computePadding() {
    var mapEl = getMapEl();
    var sidebarEl = document.querySelector(SIDEBAR_SELECTOR);

    var base = { top: EDGE_PAD, right: EDGE_PAD, bottom: EDGE_PAD, left: EDGE_PAD };
    if (!mapEl || !sidebarEl) return base;

    var mapRect = mapEl.getBoundingClientRect();
    var sideRect = sidebarEl.getBoundingClientRect();

    var obstructionSide = getObstructionSide(mapRect, sideRect);
    if (!obstructionSide) return base;

    var result = { top: base.top, right: base.right, bottom: base.bottom, left: base.left };
    if (obstructionSide === 'left')   result.left   = base.left   + Math.round(sideRect.width + GUTTER);
    if (obstructionSide === 'right')  result.right  = base.right  + Math.round(sideRect.width + GUTTER);
    if (obstructionSide === 'top')    result.top    = base.top    + Math.round(sideRect.height + GUTTER);
    if (obstructionSide === 'bottom') result.bottom = base.bottom + Math.round(sideRect.height + GUTTER);

    return result;
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
    var items = Array.from(document.querySelectorAll(LIST_ITEM_SELECTOR)).filter(isVisible);
    return items
      .map(function (el) {
        var lat = parseFloat(el.getAttribute('jb-latitude'));
        var lng = parseFloat(el.getAttribute('jb-longitude'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat: lat, lng: lng };
      })
      .filter(Boolean);
  }

  function getResultsSignature() {
    var pts = getVisiblePoints();
    return pts
      .map(function (p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); })
      .sort()
      .join('|');
  }

  function fitToVisibleMarkers(map, opts) {
    opts = opts || {};
    var maxZoom = opts.maxZoom != null ? opts.maxZoom : DEFAULT_MAX_ZOOM;
    var duration = opts.duration != null ? opts.duration : 450;

    var pts = getVisiblePoints();
    if (!pts.length) return;

    var d = motionDuration(duration);

    var padding = computePadding();
    padding.top    += FIT_EXTRA_PAD;
    padding.right  += FIT_EXTRA_PAD;
    padding.bottom += FIT_EXTRA_PAD;
    padding.left   += FIT_EXTRA_PAD;

    if (pts.length === 1) {
      map.easeTo({
        center: [pts[0].lng, pts[0].lat],
        zoom: maxZoom,
        padding: padding,
        duration: d
      });
      return;
    }

    var b = new mapboxgl.LngLatBounds([pts[0].lng, pts[0].lat], [pts[0].lng, pts[0].lat]);
    for (var i = 1; i < pts.length; i++) b.extend([pts[i].lng, pts[i].lat]);

    map.fitBounds(b, { padding: padding, maxZoom: maxZoom, duration: d });
  }

  function scheduleFit(map, opts) {
    opts = opts || {};
    var force = opts.force || false;
    var duration = opts.duration != null ? opts.duration : 450;

    if (!map) return;
    if (Date.now() < suppressAutoFitUntil) return;

    var sig = getResultsSignature();
    if (!force && sig === lastResultsSig) return;

    lastResultsSig = sig;

    if (fitTimer) clearTimeout(fitTimer);
    var myJob = ++fitJobId;

    fitTimer = setTimeout(function () {
      if (myJob !== fitJobId) return;
      if (Date.now() < suppressAutoFitUntil) return;

      var run = function () {
        if (Date.now() < suppressAutoFitUntil) return;
        fitToVisibleMarkers(map, { duration: duration });
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
    var popups = Array.from(document.querySelectorAll(POPUP_SELECTOR));
    return popups.length ? popups[popups.length - 1] : null;
  }

  function nudgePopupIntoView(map, attempt, targetEl) {
    attempt = attempt || 0;
    var mapEl = getMapEl();
    var sidebarEl = document.querySelector(SIDEBAR_SELECTOR);
    var popupEl = targetEl || getLatestPopupEl();

    if (!map || !mapEl || !sidebarEl || !popupEl || !popupEl.isConnected) return;

    var mapRect = mapEl.getBoundingClientRect();
    var sideRect = sidebarEl.getBoundingClientRect();
    var popupRect = popupEl.getBoundingClientRect();

    var obstructionSide = getObstructionSide(mapRect, sideRect);
    if (!obstructionSide) return;
    if (!rectsOverlap(popupRect, sideRect)) return;

    var shiftPopupX = 0;
    var shiftPopupY = 0;

    if (obstructionSide === 'left') {
      var minLeft = sideRect.right + GUTTER;
      if (popupRect.left < minLeft) shiftPopupX = (minLeft - popupRect.left);
    } else if (obstructionSide === 'right') {
      var maxRight = sideRect.left - GUTTER;
      if (popupRect.right > maxRight) shiftPopupX = -(popupRect.right - maxRight);
    } else if (obstructionSide === 'top') {
      var minTop = sideRect.bottom + GUTTER;
      if (popupRect.top < minTop) shiftPopupY = (minTop - popupRect.top);
    } else if (obstructionSide === 'bottom') {
      var maxBottom = sideRect.top - GUTTER;
      if (popupRect.bottom > maxBottom) shiftPopupY = -(popupRect.bottom - maxBottom);
    }

    if (!shiftPopupX && !shiftPopupY) return;

    var center = map.getCenter();
    var centerPx = map.project(center);
    var nextCenterPx = centerPx.clone();
    nextCenterPx.x -= shiftPopupX;
    nextCenterPx.y -= shiftPopupY;

    var nextCenter = map.unproject(nextCenterPx);
    map.easeTo({ center: nextCenter, duration: motionDuration(250) });

    if (attempt < 2) {
      map.once('moveend', function () {
        requestAnimationFrame(function () {
          nudgePopupIntoView(map, attempt + 1, popupEl);
        });
      });
    }
  }

  function watchForPopups(map) {
    var mapEl = getMapEl();
    if (!mapEl) return;

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var addedNodes = mutations[i].addedNodes || [];
        for (var j = 0; j < addedNodes.length; j++) {
          var node = addedNodes[j];
          if (node.nodeType === 1 && (
            (node.matches && node.matches(POPUP_SELECTOR)) ||
            (node.querySelector && node.querySelector(POPUP_SELECTOR))
          )) {
            var run = function () { requestAnimationFrame(function () { nudgePopupIntoView(map); }); };
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

    var freeze = function () { freezeAutoFit(USER_MAP_INTERACTION_FREEZE_MS); };

    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach(function (evt) {
      map.on(evt, freeze);
    });

    var canvas = map.getCanvas && map.getCanvas();
    if (canvas) {
      canvas.addEventListener('touchstart', freeze, { passive: true });
      canvas.addEventListener('wheel', freeze, { passive: true });
      canvas.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') freeze();
      }, { passive: true });
    }

    if (DISABLE_SCROLL_ZOOM_TOUCH && !isDesktopHover()) {
      try {
        if (map.scrollZoom && map.scrollZoom.disable) map.scrollZoom.disable();
        if (map.dragRotate && map.dragRotate.disable) map.dragRotate.disable();
        if (map.touchZoomRotate && map.touchZoomRotate.disableRotation) map.touchZoomRotate.disableRotation();
      } catch (e) {}
    }
  }

  // Sidebar card click: freeze auto-fit + restore scroll position
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest(TRIGGER_SELECTOR);
    if (!trigger) return;

    var scrollY = window.scrollY;

    freezeAutoFit(USER_CLICK_FREEZE_MS);

    requestAnimationFrame(function () {
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
    document.querySelectorAll(POPUP_SELECTOR).forEach(function (p) {
      var btn = p.querySelector('.mapboxgl-popup-close-button');
      if (btn) btn.click();
      else p.remove();
    });
  }

  function getInteractiveLayerIds(map) {
    var style = map.getStyle && map.getStyle();
    var layers = (style && style.layers) || [];
    var sources = (style && style.sources) || {};

    var ids = [];
    if (layers.some(function (l) { return l.id === 'xk2x'; })) ids.push('xk2x');

    for (var i = 0; i < layers.length; i++) {
      var l = layers[i];
      if (!l.source) continue;
      if (l.source === 'composite') continue;
      if (!sources[l.source]) continue;
      if (ids.indexOf(l.id) === -1) ids.push(l.id);
    }

    return ids;
  }

  function setupDesktopHover(map) {
    if (map.__swishHoverSetup) return;
    map.__swishHoverSetup = true;

    var interactiveLayers = [];
    var lastKey = null;
    var openT = null;
    var closeT = null;
    var moveRAF = null;

    var refreshLayers = function () { interactiveLayers = getInteractiveLayerIds(map); };
    refreshLayers();
    map.on('styledata', refreshLayers);

    var mapEl = getMapEl();

    var cancelClose = function () { if (closeT) clearTimeout(closeT); closeT = null; };

    var scheduleClose = function () {
      cancelClose();
      if (openT) clearTimeout(openT);
      openT = null;

      closeT = setTimeout(function () {
        if (!isDesktopHover()) return;
        closeAllPopups();
        lastKey = null;
      }, HOVER_CLOSE_DELAY);
    };

    var scheduleOpen = function (e) {
      cancelClose();
      if (openT) clearTimeout(openT);

      openT = setTimeout(function () {
        if (!isDesktopHover()) return;

        closeAllPopups();

        var originalEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        map.fire('click', { point: e.point, lngLat: e.lngLat, originalEvent: originalEvent });

        var run = function () { requestAnimationFrame(function () { nudgePopupIntoView(map); }); };
        if (map.isMoving()) map.once('moveend', run);
        else run();
      }, HOVER_OPEN_DELAY);
    };

    var handleHoverMove = function (e) {
      if (!isDesktopHover()) return;

      var overPopup = mapEl && document.elementFromPoint(e.originalEvent.clientX, e.originalEvent.clientY);
      if (overPopup && overPopup.closest && overPopup.closest(POPUP_SELECTOR)) {
        cancelClose();
        return;
      }

      if (!interactiveLayers.length) {
        scheduleClose();
        return;
      }

      var feats = map.queryRenderedFeatures(e.point, { layers: interactiveLayers });
      var f = feats && feats[0];

      if (!f) {
        scheduleClose();
        return;
      }

      var props = f.properties || {};
      var key =
        (f.id != null ? 'id:' + f.id : null) ||
        (props.id   ? 'p:' + props.id   : null) ||
        (props.slug ? 'p:' + props.slug : null) ||
        (props.name ? 'p:' + props.name : null) ||
        (f.geometry && f.geometry.coordinates
          ? 'geo:' + JSON.stringify(f.geometry.coordinates)
          : 'xy:' + Math.round(e.point.x) + ':' + Math.round(e.point.y));

      if (key === lastKey) {
        cancelClose();
        return;
      }

      lastKey = key;
      scheduleOpen(e);
    };

    // Throttled mousemove via rAF
    map.on('mousemove', function (e) {
      if (moveRAF) return;
      moveRAF = requestAnimationFrame(function () {
        moveRAF = null;
        handleHoverMove(e);
      });
    });

    if (mapEl) {
      mapEl.addEventListener('mouseleave', function () {
        if (!isDesktopHover()) return;
        scheduleClose();
      });

      mapEl.addEventListener('mouseenter', function (evt) {
        if (!isDesktopHover()) return;
        if (evt.target && evt.target.closest && evt.target.closest(POPUP_SELECTOR)) cancelClose();
      }, true);

      mapEl.addEventListener('mouseover', function (evt) {
        if (!isDesktopHover()) return;
        if (evt.target && evt.target.closest && evt.target.closest(POPUP_SELECTOR)) cancelClose();
      }, true);

      mapEl.addEventListener('mouseout', function (evt) {
        if (!isDesktopHover()) return;
        var related = evt.relatedTarget;
        if (evt.target && evt.target.closest && evt.target.closest(POPUP_SELECTOR) &&
            (!related || !related.closest || !related.closest(POPUP_SELECTOR))) {
          scheduleClose();
        }
      }, true);
    }
  }

  // ---------------------------
  // 4) Capture Jetboost's Mapbox instance
  // ---------------------------
  function patchMapbox() {
    if (!window.mapboxgl || !window.mapboxgl.Map || window.__swishMapboxPatched) return;
    window.__swishMapboxPatched = true;

    var OriginalMap = window.mapboxgl.Map;

    function PatchedMap(options) {
      var map = new OriginalMap(options);

      try {
        var container =
          typeof options.container === 'string'
            ? document.getElementById(options.container)
            : options.container;

        if (container && container.matches && container.matches(MAP_SELECTOR)) {
          window.__swishJetboostMap = map;

          var run = function () {
            applyPadding(map);
            lastResultsSig = getResultsSignature();
            scheduleFit(map, { force: true, duration: 0 });
            watchForPopups(map);
            bindUserInteractionFreeze(map);
            disableCanvasFocusFn(map);
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

  var patchAttempts = 0;
  var patchTimer = setInterval(function () {
    patchMapbox();
    if (window.__swishMapboxPatched || ++patchAttempts > 200) clearInterval(patchTimer);
  }, 50);

  // ---------------------------
  // 5) Re-run on Jetboost changes
  // ---------------------------
  function rerun(opts) {
    opts = opts || {};
    var forceFit = opts.forceFit || false;
    var duration = opts.duration != null ? opts.duration : 450;

    var map = getMap();
    if (!map) return;

    requestAnimationFrame(function () {
      applyPadding(map);

      if (Date.now() < suppressAutoFitUntil) {
        nudgePopupIntoView(map);
        return;
      }

      scheduleFit(map, { force: forceFit, duration: duration });
      nudgePopupIntoView(map);
    });
  }

  var prev = window.JetboostListUpdated;
  window.JetboostListUpdated = function (collectionList) {
    try { if (typeof prev === 'function') prev(collectionList); }
    finally { rerun({ forceFit: true, duration: 450 }); }
  };

  // MutationObserver: bail early if the point set hasn't changed
  var mo = new MutationObserver(function () {
    var sig = getResultsSignature();
    if (sig === lastResultsSig) return;
    rerun({ forceFit: false, duration: 450 });
  });

  function watchList() {
    var list = document.querySelector('.map_list-new');
    if (list) mo.observe(list, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchList);
  else watchList();

  // Debounced resize
  var resizeT = null;
  window.addEventListener('resize', function () {
    if (resizeT) clearTimeout(resizeT);
    resizeT = setTimeout(function () { rerun({ forceFit: false, duration: 0 }); }, 150);
  });
})();
