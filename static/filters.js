/**
 * filters.js -- Filter UI module.
 * Renders 4 checkbox lists (retailer / zone / state / cluster).
 * Single-click toggles. URL sync. 250ms debounce. Clear-all support.
 */
(function (global) {
  'use strict';

  const DEBOUNCE_MS = 250;
  const FILTER_KEYS = ['retailer', 'zone', 'state', 'cluster'];
  const FILTER_LABELS = {
    retailer: 'Retailer',
    zone: 'Zone',
    state: 'State',
    cluster: 'Cluster',
  };

  // Per-key registry: { value: HTMLInputElement(checkbox) }
  const checkboxes = Object.create(null);
  const counters = Object.create(null);
  let _meta = null;
  let _onChange = null;
  let _debounceTimer = null;
  let _filteredCountEl = null;

  function resolveInnerMount(mp) {
    if (!mp) throw new Error('Filters.init: mountPoint required');
    if (mp.id === 'filters-mount') return mp;
    const inner = mp.querySelector && mp.querySelector('#filters-mount');
    return inner || mp;
  }

  function readUrlState() {
    const params = new URLSearchParams(global.location.search);
    const out = {};
    for (const k of FILTER_KEYS) {
      out[k] = params.getAll(k).filter(v => !!v);
    }
    return out;
  }

  function writeUrlState(state) {
    const params = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const vals = state[k] || [];
      for (const v of vals) params.append(k, v);
    }
    const qs = params.toString();
    const newUrl = global.location.pathname + (qs ? '?' + qs : '') + global.location.hash;
    global.history.replaceState(null, '', newUrl);
  }

  function readSelectedState() {
    const out = {};
    for (const k of FILTER_KEYS) {
      const map = checkboxes[k] || {};
      out[k] = Object.keys(map).filter(v => map[v].checked);
    }
    return out;
  }

  function applyStateToCheckboxes(state) {
    for (const k of FILTER_KEYS) {
      const map = checkboxes[k] || {};
      const wanted = new Set((state[k] || []).map(String));
      for (const v of Object.keys(map)) map[v].checked = wanted.has(v);
    }
  }

  function refreshClearAllEnabled(state) {
    const btn = global.document.getElementById('clear-all');
    if (!btn) return;
    const any = FILTER_KEYS.some(k => (state[k] || []).length > 0);
    btn.disabled = !any;
  }

  function scheduleChange(opts) {
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    const immediate = opts && opts.immediate;
    function fire() {
      _debounceTimer = null;
      const state = readSelectedState();
      writeUrlState(state);
      refreshClearAllEnabled(state);
      if (typeof _onChange === 'function') {
        try { _onChange(state); }
        catch (e) { console.error('Filters onChange threw:', e); }
      }
    }
    if (immediate) fire();
    else _debounceTimer = setTimeout(fire, DEBOUNCE_MS);
  }

  function buildFilter(key, options, parent) {
    const doc = global.document;
    const wrapper = doc.createElement('div');
    wrapper.className = 'flex flex-col gap-1';
    wrapper.dataset.filter = key;

    // header row: label + count
    const labelRow = doc.createElement('div');
    labelRow.className = 'flex items-center justify-between';
    const label = doc.createElement('div');
    label.className = 'text-xs font-semibold uppercase tracking-wide text-slate-600';
    label.textContent = FILTER_LABELS[key] || key;
    const counter = doc.createElement('span');
    counter.className = 'text-xs text-slate-400';
    counter.textContent = '(' + options.length + ')';
    counters[key] = counter;
    labelRow.appendChild(label);
    labelRow.appendChild(counter);
    wrapper.appendChild(labelRow);

    // scrollable checkbox list
    const list = doc.createElement('div');
    list.className = 'max-h-44 overflow-y-auto rounded border border-slate-200 bg-white p-2 ' +
                     'flex flex-col gap-1';

    checkboxes[key] = Object.create(null);
    for (const opt of options) {
      const value = (opt && typeof opt === 'object') ? String(opt.value) : String(opt);
      const text  = (opt && typeof opt === 'object') ? (opt.label || value) : value;

      const row = doc.createElement('label');
      row.className = 'flex items-center gap-2 cursor-pointer text-sm hover:bg-slate-50 rounded px-1';

      const cb = doc.createElement('input');
      cb.type = 'checkbox';
      cb.value = value;
      cb.className = 'h-4 w-4 cursor-pointer';
      cb.addEventListener('change', () => scheduleChange());

      const span = doc.createElement('span');
      span.textContent = text;
      span.className = 'text-slate-700';

      row.appendChild(cb);
      row.appendChild(span);
      list.appendChild(row);

      checkboxes[key][value] = cb;
    }
    wrapper.appendChild(list);
    parent.appendChild(wrapper);
  }

  function deriveOptions(meta) {
    const retailers = Array.isArray(meta && meta.retailers) ? meta.retailers.slice().sort() : [];
    const states    = Array.isArray(meta && meta.states)    ? meta.states.slice().sort()    : [];
    const clusters  = Array.isArray(meta && meta.clusters)  ? meta.clusters.slice().sort()  : [];
    const zones = Array.isArray(meta && meta.zones)
      ? meta.zones.map(z => ({ value: z.slug, label: z.display || z.slug }))
      : [];
    return { retailer: retailers, zone: zones, state: states, cluster: clusters };
  }

  function ensureFilteredCountEl(mountPoint) {
    const doc = global.document;
    let el = doc.getElementById('filtered-count');
    if (el) { _filteredCountEl = el; return; }
    const status = doc.getElementById('status-line');
    el = doc.createElement('span');
    el.id = 'filtered-count';
    el.className = 'font-mono text-slate-600';
    el.textContent = '--';
    if (status) {
      status.textContent = '';
      status.appendChild(el);
      const sep = doc.createElement('span');
      sep.className = 'mx-1 text-slate-400'; sep.textContent = '/';
      const total = doc.createElement('span');
      total.id = 'filtered-total';
      total.className = 'font-mono text-slate-400';
      total.textContent = (_meta && Number.isFinite(_meta.total_rows))
        ? String(_meta.total_rows) : '--';
      status.appendChild(sep); status.appendChild(total);
    } else {
      mountPoint.appendChild(el);
    }
    _filteredCountEl = el;
  }

  function clearAll() {
    for (const k of FILTER_KEYS) {
      const map = checkboxes[k] || {};
      for (const v of Object.keys(map)) map[v].checked = false;
    }
    scheduleChange({ immediate: true });
  }

  function wireClearAll(mountPoint) {
    const btn = global.document.getElementById('clear-all');
    if (!btn) return;
    if (btn.dataset && btn.dataset.filtersBound === '1') return;
    btn.addEventListener('click', clearAll);
    if (btn.dataset) btn.dataset.filtersBound = '1';
  }

  function init(opts) {
    if (!opts || !opts.mountPoint) throw new Error('Filters.init: mountPoint required');
    _meta = opts.meta || {};
    _onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

    const innerMount = resolveInnerMount(opts.mountPoint);
    while (innerMount.firstChild) innerMount.removeChild(innerMount.firstChild);

    const optionsByKey = deriveOptions(_meta);
    for (const k of FILTER_KEYS) {
      buildFilter(k, optionsByKey[k] || [], innerMount);
    }

    wireClearAll(opts.mountPoint);
    ensureFilteredCountEl(opts.mountPoint);

    const urlState = readUrlState();
    applyStateToCheckboxes(urlState);
    refreshClearAllEnabled(urlState);
    writeUrlState(urlState);
    if (typeof _onChange === 'function') {
      try { _onChange(urlState); }
      catch (e) { console.error('Filters initial onChange threw:', e); }
    }
    return { state: urlState };
  }

  function setFilteredCount(n) {
    if (!_filteredCountEl) return;
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      _filteredCountEl.textContent = '--'; return;
    }
    _filteredCountEl.textContent = n.toLocaleString();
    const headerCount = global.document.getElementById('total-count');
    if (headerCount) headerCount.textContent = n.toLocaleString();
    const grand = global.document.getElementById('grand-total');
    if (grand && _meta && Number.isFinite(_meta.total_rows)) {
      grand.textContent = _meta.total_rows.toLocaleString();
    }
  }

  function getState() { return readSelectedState(); }

  function setState(next) {
    applyStateToCheckboxes(next || {});
    scheduleChange({ immediate: true });
  }

  global.Filters = {
    init: init,
    setFilteredCount: setFilteredCount,
    getState: getState,
    setState: setState,
    clear: clearAll,
    _DEBOUNCE_MS: DEBOUNCE_MS,
    _FILTER_KEYS: FILTER_KEYS,
  };
})(typeof window !== 'undefined' ? window : this);
