/* app.js -- entrypoint for the retail store dashboard frontend.
 *
 * STATIC-MODE: loads data.json once, filters in-memory, no backend needed.
 * Designed for Vercel-style static deployment but also works under FastAPI.
 */
(function () {
  'use strict';

  var PALETTE = [
    [31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40],
    [148, 103, 189], [140, 86, 75], [227, 119, 194], [127, 127, 127],
  ];
  var DEBOUNCE_MS = 250;

  function $(id) { return document.getElementById(id); }
  function setText(id, v) { var el = $(id); if (el) el.textContent = String(v); }
  function showError(msg) {
    var el = $('error-banner'); if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('pointer-events-auto');
    clearTimeout(showError._t);
    showError._t = setTimeout(function () { el.classList.add('hidden'); }, 5000);
  }
  function setStatus(msg) { setText('status-line', msg); }
  function hideLoading() { var el = $('loading'); if (el) el.classList.add('hidden'); }

  function wireMobileToggle() {
    var btn = $('mobile-toggle'); var aside = $('filters');
    if (!btn || !aside) return;
    btn.addEventListener('click', function () {
      var hidden = aside.classList.toggle('hidden');
      aside.classList.toggle('flex', !hidden);
      btn.setAttribute('aria-expanded', String(!hidden));
    });
  }

  // ---- Data + filtering --------------------------------------------------

  var DATA = null;        // { meta, stores }
  var ZONE_TO_STATES = {}; // built from meta.zones

  function buildZoneIndex(meta) {
    var idx = {};
    if (meta && Array.isArray(meta.zones)) {
      meta.zones.forEach(function (z) {
        idx[z.slug] = new Set(z.states || []);
      });
    }
    return idx;
  }

  function filterStores(state) {
    if (!DATA) return [];
    var stores = DATA.stores;
    var ra = (state.retailer && state.retailer.length) ? new Set(state.retailer) : null;
    var st = (state.state    && state.state.length)    ? new Set(state.state)    : null;
    var cl = (state.cluster  && state.cluster.length)  ? new Set(state.cluster)  : null;
    var zoneStates = null;
    if (state.zone && state.zone.length) {
      zoneStates = new Set();
      state.zone.forEach(function (slug) {
        var s = ZONE_TO_STATES[slug];
        if (s) s.forEach(function (v) { zoneStates.add(v); });
      });
    }
    if (!ra && !st && !cl && !zoneStates) return stores;
    var out = [];
    for (var i = 0; i < stores.length; i++) {
      var s = stores[i];
      if (ra && !ra.has(s.ra)) continue;
      if (st && !st.has(s.st)) continue;
      if (zoneStates && !zoneStates.has(s.st)) continue;
      if (cl && !cl.has(s.cl)) continue;
      out.push(s);
    }
    return out;
  }

  // ---- Bootstrap ---------------------------------------------------------

  var debounceTimer = null;
  var currentFilters = {};

  function applyFilters(nextState) {
    currentFilters = nextState || {};
    var clearBtn = $('clear-all');
    var anySelected = ['retailer','state','zone','cluster'].some(function (k) {
      return Array.isArray(currentFilters[k]) && currentFilters[k].length > 0;
    });
    if (clearBtn) clearBtn.disabled = !anySelected;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      var subset = filterStores(currentFilters);
      setText('total-count', subset.length.toLocaleString());
      if (window.MapViz && typeof window.MapViz.update === 'function') {
        window.MapViz.update(subset);
      }
      if (window.Filters && typeof window.Filters.setFilteredCount === 'function') {
        window.Filters.setFilteredCount(subset.length);
      }
      setStatus(subset.length.toLocaleString() + ' stores');
    }, DEBOUNCE_MS);
  }

  function init() {
    wireMobileToggle();
    var clearBtn = $('clear-all');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (window.Filters && typeof window.Filters.clear === 'function') {
          window.Filters.clear();
        } else {
          applyFilters({});
        }
      });
    }
    setStatus('Loading data...');
    fetch('data.json', { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' loading data.json');
        return r.json();
      })
      .then(function (payload) {
        DATA = payload;
        ZONE_TO_STATES = buildZoneIndex(payload.meta);
        var meta = payload.meta;
        setText('grand-total', meta.total_rows.toLocaleString());
        var schemaEl = $('schema-badge');
        if (schemaEl && meta.schema_version) {
          schemaEl.textContent = 'schema ' + meta.schema_version;
          schemaEl.classList.remove('hidden');
        }
        if (window.MapViz && typeof window.MapViz.init === 'function') {
          try { window.MapViz.init({ container: $('map'), palette: PALETTE }); }
          catch (e) { showError('Map init failed: ' + e.message); }
        }
        if (window.Filters && typeof window.Filters.init === 'function') {
          try {
            window.Filters.init({
              mountPoint: $('filters-mount'),
              meta: meta,
              onChange: applyFilters,
            });
          } catch (e) { showError('Filters init failed: ' + e.message); }
        }
        // Trigger first render with whatever URL state Filters sees.
        // Filters.init already calls onChange(urlState) once.
      })
      .catch(function (err) {
        console.error(err);
        showError('Failed to load data: ' + err.message);
        setStatus('Error loading data');
      })
      .finally(hideLoading);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__app = {
    getFilters: function () { return currentFilters; },
    refresh: function () { applyFilters(currentFilters); },
    getData: function () { return DATA; },
  };
})();
