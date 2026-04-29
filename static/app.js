/* app.js — entrypoint for the retail store dashboard frontend.
 * STATIC-MODE: loads data.json once, filters in-memory, no backend.
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

  var DATA = null;
  var ZONE_TO_STATES = {};
  var STATE_TO_REGION = {};

  function buildZoneIndex(meta) {
    var idx = {};
    if (meta && Array.isArray(meta.zones)) {
      meta.zones.forEach(function (z) { idx[z.slug] = new Set(z.states || []); });
    }
    return idx;
  }
  function buildStateToRegion(meta) {
    var m = {};
    if (meta && Array.isArray(meta.zones)) {
      meta.zones.forEach(function (z) {
        (z.states || []).forEach(function (s) { m[s] = z.display || z.slug; });
      });
    }
    return m;
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

  // ---- CSV export --------------------------------------------------------

  function csvEscape(v) {
    if (v == null) return '';
    var s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function todayStamp() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function buildCSV(stores) {
    var headers = ['Retailer', 'Region', 'State', 'Address', 'Zip Code', 'Coordinates'];
    var lines = [headers.join(',')];
    for (var i = 0; i < stores.length; i++) {
      var s = stores[i];
      var region = STATE_TO_REGION[s.st] || '';
      var coord = (s.la != null && s.lo != null)
        ? (Number(s.la).toFixed(6) + ', ' + Number(s.lo).toFixed(6))
        : '';
      lines.push([
        csvEscape(s.ra),
        csvEscape(region),
        csvEscape(s.st),
        csvEscape(s.ad),
        csvEscape(s.zp),
        csvEscape(coord),
      ].join(','));
    }
    return '﻿' + lines.join('\n');  // BOM so Excel reads UTF-8 cleanly
  }

  function downloadCurrent() {
    var subset = filterStores(currentFilters);
    if (!subset.length) {
      showError('No stores in the current filter to download.');
      return;
    }
    var anyFilter = ['retailer','state','zone','cluster'].some(function (k) {
      return Array.isArray(currentFilters[k]) && currentFilters[k].length > 0;
    });
    var csv = buildCSV(subset);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'stores_' + (anyFilter ? 'filtered' : 'all') + '_' +
                 todayStamp() + '_' + subset.length + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    setStatus('downloaded ' + subset.length.toLocaleString() + ' stores');
  }

  function wireDownload() {
    var btn = $('download-csv');
    if (!btn) return;
    btn.addEventListener('click', downloadCurrent);
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
    wireDownload();
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
        ZONE_TO_STATES   = buildZoneIndex(payload.meta);
        STATE_TO_REGION  = buildStateToRegion(payload.meta);
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
    download: downloadCurrent,
  };
})();
