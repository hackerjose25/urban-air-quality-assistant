'use strict';

/**
 * Frontend controller: location search, profile form, and rendering of the
 * live air data and personalised plan. All DOM writes use textContent (XSS-safe).
 */
(() => {
  /** @param {string} id */
  const $ = (id) => document.getElementById(id);
  const state = { lat: null, lon: null, city: '' };
  const STORAGE_KEY = 'uaqa-profile';
  const MIN_QUERY_LENGTH = 2;
  const MAX_COMMUTE_KM = 200;
  const GEO_OPTIONS = Object.freeze({ timeout: 10_000, maximumAge: 600_000 });
  const SUBMIT_LABEL = 'Get my plan';
  const BUSY_LABEL = 'Building your plan…';
  /** Extract "HH:MM" from an ISO local time such as 2026-11-27T14:00. */
  const hourOf = (isoTime) => isoTime.slice(11, 16);

  const AQI_COLORS = [
    [50, '#2e7d32'], [100, '#c9a000'], [150, '#e07000'],
    [200, '#c62828'], [300, '#6a1b9a'], [Infinity, '#4e0d1c'],
  ];
  /** Colour of the US EPA band that contains this AQI. */
  const colorFor = (aqi) => AQI_COLORS.find(([max]) => aqi <= max)[1];

  /** Announce a status message to screen readers via the live region. */
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

  /**
   * Create an element safely.
   * @param {string} tag
   * @param {Record<string,string>} [props] `text` sets textContent, `class` sets className, others are attributes
   * @param {Node[]} [children]
   */
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

  /** Store the chosen coordinates, show them, and persist the profile. */
  function setLocation(lat, lon, name) {
    state.lat = lat;
    state.lon = lon;
    state.city = name || '';
    $('selected-location').textContent = `Selected: ${name || `${lat.toFixed(2)}, ${lon.toFixed(2)}`}`;
    $('city-results').hidden = true;
    saveProfile();
  }

  /**
   * Call the backend and return its JSON.
   * @throws {Error} with the server's error message on non-2xx responses
   */
  async function api(path, opts) {
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  /** Look up the typed city and list matching places as buttons. */
  async function searchCity() {
    setError('');
    const q = $('city').value.trim();
    if (q.length < MIN_QUERY_LENGTH) { setError('Type at least 2 characters to search.', 'city'); return; }
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

  /** Use the browser's geolocation as the location. */
  function locate() {
    setError('');
    if (!navigator.geolocation) { setError('Your browser does not support location access.'); return; }
    announce('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(pos.coords.latitude, pos.coords.longitude, 'Your current location'),
      () => setError('Could not get your location. Search for your city instead.'),
      GEO_OPTIONS,
    );
  }

  /** Read the form into the request body sent to /api/advice. */
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

  /** Remember the profile locally so returning users skip the form. */
  function saveProfile() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collectProfile())); } catch { /* storage unavailable */ }
  }

  /** Refill the form from a previously saved profile. */
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

  /** Render advice items, each with its Impact line. */
  function renderList(id, items) {
    $(id).replaceChildren(...items.map((i) => el('li', {}, [
      el('strong', { text: i.title }),
      el('p', { text: i.detail }),
      el('p', { class: 'impact', text: `Impact: ${i.impact}` }),
    ])));
  }

  /** Show the headline AQI and its category colour. */
  function renderAqi(air, advice) {
    $('aqi-card').style.setProperty('--aqi-color', colorFor(air.aqi));
    $('aqi-number').textContent = Math.round(air.aqi);
    $('aqi-category').textContent = advice.category.label;
  }

  /** Show pollutant concentrations as a definition list. */
  function renderPollutants(air) {
    const fmt = (v) => (typeof v === 'number' ? `${v.toFixed(1)} µg/m³` : 'n/a');
    $('pollutants').replaceChildren(
      ...[['PM2.5', air.pm25], ['PM10', air.pm10], ['NO₂', air.no2], ['O₃', air.o3]]
        .flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: fmt(v) })]),
    );
  }

  /** Draw the 24-hour bars and describe the cleanest and worst hours. */
  function renderForecast(hours) {
    const max = Math.max(...hours.map((h) => h.aqi), 1);
    $('forecast-bars').replaceChildren(...hours.map((h) => {
      const bar = el('span', { title: `${hourOf(h.time)}: AQI ${h.aqi}` });
      bar.style.height = `${(h.aqi / max) * 100}%`;
      bar.style.background = colorFor(h.aqi);
      return bar;
    }));
    if (!hours.length) return;
    const best = hours.reduce((a, b) => (b.aqi < a.aqi ? b : a));
    const worst = hours.reduce((a, b) => (b.aqi > a.aqi ? b : a));
    const text = `Cleanest hour: ${hourOf(best.time)} (AQI ${best.aqi}). Worst: ${hourOf(worst.time)} (AQI ${worst.aqi}).`;
    $('best-window').textContent = text;
    $('forecast-bars').setAttribute('aria-label', `AQI forecast chart for the next 24 hours. ${text}`);
  }

  /** Show the summary, its source, and the three advice sections. */
  function renderAdvice(advice) {
    $('summary').textContent = advice.summary;
    $('source').textContent = advice.source === 'gemini'
      ? 'Personalised by Google Gemini, grounded in live air data.'
      : 'Generated by the built-in expert rule engine.';
    renderList('routines', advice.routines);
    renderList('indoor', advice.indoor);
    renderList('sustainable', advice.sustainable);
  }

  /** Render the whole result and move focus to it. */
  function render({ air, advice }) {
    renderAqi(air, advice);
    renderPollutants(air);
    renderForecast(air.hourly || []);
    renderAdvice(advice);
    $('results').hidden = false;
    $('aqi-card').setAttribute('tabindex', '-1');
    $('aqi-card').focus();
  }

  /** Toggle the loading state on the submit button and results region. */
  function setBusy(busy) {
    const btn = $('submit-btn');
    btn.disabled = busy;
    btn.textContent = busy ? BUSY_LABEL : SUBMIT_LABEL;
    if (busy) $('results').setAttribute('aria-busy', 'true');
    else $('results').removeAttribute('aria-busy');
  }

  /** Validate the form; returns false (and shows an error) when invalid. */
  function validateForm() {
    if (state.lat === null) { setError('Choose a location first.', 'city'); return false; }
    const km = Number($('commuteKm').value);
    if (!(km >= 0 && km <= MAX_COMMUTE_KM)) {
      setError(`Commute distance must be between 0 and ${MAX_COMMUTE_KM} km.`, 'commuteKm');
      return false;
    }
    return true;
  }

  /** Form submit: fetch air data and the plan, then render it. */
  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!validateForm()) return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  $('search-btn').addEventListener('click', searchCity);
  $('city').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchCity(); } });
  $('locate-btn').addEventListener('click', locate);
  $('profile-form').addEventListener('submit', submit);
  restoreProfile();
})();
