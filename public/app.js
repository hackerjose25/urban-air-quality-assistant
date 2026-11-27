'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const state = { lat: null, lon: null, city: '' };
  const STORAGE_KEY = 'uaqa-profile';

  const AQI_COLORS = [
    [50, '#2e7d32'], [100, '#c9a000'], [150, '#e07000'],
    [200, '#c62828'], [300, '#6a1b9a'], [Infinity, '#4e0d1c'],
  ];
  const colorFor = (aqi) => AQI_COLORS.find(([max]) => aqi <= max)[1];

  function announce(msg) { $('status').textContent = msg; }
  /** Show an error and mark the offending field invalid (or clear all errors). */
  function setError(msg, fieldId) {
    $('form-error').textContent = msg || '';
    document.querySelectorAll('[aria-invalid="true"]').forEach((f) => f.removeAttribute('aria-invalid'));
    if (msg && fieldId) {
      const field = $(fieldId);
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-errormessage', 'form-error');
      field.focus();
    }
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v; // textContent only, never innerHTML (XSS-safe)
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    });
    children.forEach((c) => node.appendChild(c));
    return node;
  }

  function setLocation(lat, lon, name) {
    state.lat = lat;
    state.lon = lon;
    state.city = name || '';
    $('selected-location').textContent = `Selected: ${name || `${lat.toFixed(2)}, ${lon.toFixed(2)}`}`;
    $('city-results').hidden = true;
    saveProfile();
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function searchCity() {
    setError('');
    const q = $('city').value.trim();
    if (q.length < 2) { setError('Type at least 2 characters to search.', 'city'); return; }
    announce('Searching…');
    try {
      const { results } = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
      const list = $('city-results');
      list.replaceChildren();
      if (!results.length) { setError('No places found. Try a different spelling.'); return; }
      results.forEach((r) => {
        const btn = el('button', { type: 'button', text: r.name });
        btn.addEventListener('click', () => setLocation(r.lat, r.lon, r.name));
        list.appendChild(el('li', {}, [btn]));
      });
      list.hidden = false;
      announce(`${results.length} places found.`);
      list.querySelector('button').focus();
    } catch (e) { setError(e.message); }
  }

  function locate() {
    setError('');
    if (!navigator.geolocation) { setError('Your browser does not support location access.'); return; }
    announce('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(pos.coords.latitude, pos.coords.longitude, 'Your current location'),
      () => setError('Could not get your location. Search for your city instead.'),
      { timeout: 10000, maximumAge: 600000 },
    );
  }

  function collectProfile() {
    return {
      lat: state.lat,
      lon: state.lon,
      city: state.city,
      household: [...document.querySelectorAll('input[name="household"]:checked')].map((c) => c.value),
      commuteMode: $('commuteMode').value,
      commuteKm: Number($('commuteKm').value) || 0,
      hasPurifier: $('hasPurifier').checked,
    };
  }

  function saveProfile() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collectProfile())); } catch { /* storage unavailable */ }
  }

  function restoreProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!p) return;
      (p.household || []).forEach((h) => {
        const cb = document.querySelector(`input[name="household"][value="${CSS.escape(h)}"]`);
        if (cb) cb.checked = true;
      });
      if (p.commuteMode) $('commuteMode').value = p.commuteMode;
      if (p.commuteKm) $('commuteKm').value = p.commuteKm;
      $('hasPurifier').checked = Boolean(p.hasPurifier);
      if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) setLocation(p.lat, p.lon, p.city);
    } catch { /* ignore corrupt storage */ }
  }

  function renderList(id, items) {
    $(id).replaceChildren(...items.map((i) => el('li', {}, [
      el('strong', { text: i.title }),
      el('p', { text: i.detail }),
      el('p', { class: 'impact', text: `Impact: ${i.impact}` }),
    ])));
  }

  function render({ air, advice }) {
    const color = colorFor(air.aqi);
    $('aqi-card').style.setProperty('--aqi-color', color);
    $('aqi-number').textContent = Math.round(air.aqi);
    $('aqi-category').textContent = advice.category.label;

    const fmt = (v) => (typeof v === 'number' ? `${v.toFixed(1)} µg/m³` : 'n/a');
    $('pollutants').replaceChildren(
      ...[['PM2.5', air.pm25], ['PM10', air.pm10], ['NO₂', air.no2], ['O₃', air.o3]]
        .flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: fmt(v) })]),
    );

    const hours = air.hourly || [];
    const max = Math.max(...hours.map((h) => h.aqi), 1);
    $('forecast-bars').replaceChildren(...hours.map((h) => {
      const bar = el('span', { title: `${h.time.slice(11, 16)}: AQI ${h.aqi}` });
      bar.style.height = `${(h.aqi / max) * 100}%`;
      bar.style.background = colorFor(h.aqi);
      return bar;
    }));
    if (hours.length) {
      const best = hours.reduce((a, b) => (b.aqi < a.aqi ? b : a));
      const worst = hours.reduce((a, b) => (b.aqi > a.aqi ? b : a));
      const text = `Cleanest hour: ${best.time.slice(11, 16)} (AQI ${best.aqi}). Worst: ${worst.time.slice(11, 16)} (AQI ${worst.aqi}).`;
      $('best-window').textContent = text;
      $('forecast-bars').setAttribute('aria-label', `AQI forecast chart for the next 24 hours. ${text}`);
    }

    $('summary').textContent = advice.summary;
    $('source').textContent = advice.source === 'gemini'
      ? 'Personalised by Google Gemini, grounded in live air data.'
      : 'Generated by the built-in expert rule engine.';
    renderList('routines', advice.routines);
    renderList('indoor', advice.indoor);
    renderList('sustainable', advice.sustainable);

    $('results').hidden = false;
    $('aqi-card').setAttribute('tabindex', '-1');
    $('aqi-card').focus();
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (state.lat === null) { setError('Choose a location first.', 'city'); return; }
    const km = Number($('commuteKm').value);
    if (!(km >= 0 && km <= 200)) { setError('Commute distance must be between 0 and 200 km.', 'commuteKm'); return; }

    const btn = $('submit-btn');
    btn.disabled = true;
    $('results').setAttribute('aria-busy', 'true');
    btn.textContent = 'Building your plan…';
    announce('Fetching air quality and building your plan…');
    saveProfile();
    try {
      const data = await api('/api/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectProfile()),
      });
      render(data);
      announce(`Plan ready. AQI is ${Math.round(data.air.aqi)}, ${data.advice.category.label}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Get my plan';
      $('results').removeAttribute('aria-busy');
    }
  }

  $('search-btn').addEventListener('click', searchCity);
  $('city').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchCity(); } });
  $('locate-btn').addEventListener('click', locate);
  $('profile-form').addEventListener('submit', submit);
  restoreProfile();
})();
