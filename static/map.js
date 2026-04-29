/**
 * map.js -- deck.gl ScatterplotLayer + MapLibre base map.
 * US-constrained: maxBounds prevents panning out of North America,
 * minZoom keeps stores in view.
 */
(function (global) {
  'use strict';

  const DEFAULT_PALETTE = {
    'Chain Drug':        [220,  53,  69],
    'Chain Restaurant':  [  0, 123, 167],
    'Convenience':       [255, 159,  28],
    'Mass Merchandiser': [ 40, 167,  69],
    '_slot4':            [111,  66, 193],
    '_slot5':            [253, 126,  20],
    '_slot6':            [ 32, 201, 151],
    '_slot7':            [232,  62, 140],
    '_default':          [108, 117, 125],
  };

  // Bounds: SW corner, NE corner. Generous around US (incl. AK + HI + PR).
  const US_MAX_BOUNDS = [[-170, 18], [-65, 72]];
  // Initial fit-to-CONUS bounds (tighter).
  const CONUS_BOUNDS  = [[-128, 22], [-65, 50]];

  let _map = null;
  let _deck = null;
  let _palette = null;
  let _containerEl = null;

  function _resolveContainer(c) {
    if (typeof c === 'string') return document.getElementById(c);
    return c;
  }

  function _colorFor(cluster) {
    if (!_palette) _palette = DEFAULT_PALETTE;
    return _palette[cluster] || _palette._default || [108, 117, 125];
  }

  function _ensureLibsLoaded() {
    if (typeof global.maplibregl === 'undefined')
      throw new Error('[MapViz] maplibre-gl not loaded');
    if (typeof global.deck === 'undefined')
      throw new Error('[MapViz] deck.gl not loaded');
  }

  function _buildScatterLayer(stores) {
    const { ScatterplotLayer } = global.deck;
    return new ScatterplotLayer({
      id: 'stores-scatter',
      data: stores,
      pickable: true,
      stroked: true,
      filled: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      getLineColor: [255, 255, 255, 200],
      radiusUnits: 'pixels',
      getRadius: 7,
      radiusMinPixels: 5,
      radiusMaxPixels: 14,
      getPosition: d => [d.lo, d.la],
      getFillColor: d => _colorFor(d.cl),
      updateTriggers: {
        getFillColor: [stores],
        getPosition:  [stores],
      },
      onClick: info => {
        if (!info || !info.object) return;
        _showPopup(info.object, info.coordinate);
      },
    });
  }

  function _showPopup(store, coord) {
    if (!_map || !global.maplibregl) return;
    const lng = (coord && coord[0]) != null ? coord[0] : store.lo;
    const lat = (coord && coord[1]) != null ? coord[1] : store.la;
    const safe = s => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const html =
      '<div style="font:13px system-ui,sans-serif;line-height:1.35;max-width:240px">' +
      '<div style="font-weight:600;margin-bottom:2px">' + safe(store.ra) + '</div>' +
      '<div>' + safe(store.ad) + '</div>' +
      '<div>' + safe(store.ci) + ', ' + safe(store.st) + ' ' + safe(store.zp) + '</div>' +
      '<div style="margin-top:6px">' +
      '<a href="' + safe(store.gm) + '" target="_blank" rel="noopener" ' +
      'style="color:#0d6efd;text-decoration:underline">Open in Google Maps</a>' +
      '</div></div>';
    new global.maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px' })
      .setLngLat([lng, lat]).setHTML(html).addTo(_map);
  }

  const MapViz = {
    init({ container, palette } = {}) {
      _ensureLibsLoaded();
      _containerEl = _resolveContainer(container);
      if (!_containerEl) throw new Error('[MapViz] init: container not found');
      _palette = palette && typeof palette === 'object' && !Array.isArray(palette)
        ? palette : DEFAULT_PALETTE;

      _map = new global.maplibregl.Map({
        container: _containerEl,
        style: 'https://demotiles.maplibre.org/style.json',
        bounds: CONUS_BOUNDS,           // open fit on US
        fitBoundsOptions: { padding: 30 },
        maxBounds: US_MAX_BOUNDS,       // can't pan out
        minZoom: 4,                     // can't zoom out past US
        maxZoom: 14,
        attributionControl: true,
      });

      _map.addControl(new global.maplibregl.NavigationControl({ showCompass: false }), 'top-right');

      const { MapboxOverlay } = global.deck;
      _deck = new MapboxOverlay({ interleaved: false, layers: [] });
      _map.addControl(_deck);
      return MapViz;
    },

    update(stores) {
      if (!_deck) throw new Error('[MapViz] update() called before init()');
      const arr = Array.isArray(stores) ? stores : [];
      const layer = _buildScatterLayer(arr);
      _deck.setProps({ layers: [layer] });
      global.__pinCount = arr.length;
      return MapViz;
    },

    destroy() {
      try { if (_deck && _map) _map.removeControl(_deck); } catch (e) {}
      _deck = null;
      try { if (_map) _map.remove(); } catch (e) {}
      _map = null; _containerEl = null; global.__pinCount = 0;
      return MapViz;
    },

    _palette: DEFAULT_PALETTE,
    _colorFor: _colorFor,
  };

  global.MapViz = MapViz;
})(window);
