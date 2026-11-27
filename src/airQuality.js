'use strict';

const { TtlCache } = require('./cache');

const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';

async function fetchJson(url, fetchImpl, timeoutMs = 8000) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Upstream error ${res.status}`);
  return res.json();
}

/**
 * Build Open-Meteo clients (free, no API key) with their own cache.
 * @param {{fetchImpl?: typeof fetch, cache?: TtlCache}} [opts]
 */
function createAirQualityClient({ fetchImpl = fetch, cache = new TtlCache() } = {}) {
  /**
   * Current air quality plus the next 24 hours of AQI forecast.
   * Coordinates are rounded to about 1 km, for privacy and better cache hits.
   */
  async function getAirQuality(lat, lon) {
    const rl = lat.toFixed(2);
    const ro = lon.toFixed(2);
    const key = `aq:${rl},${ro}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const params = new URLSearchParams({
      latitude: rl,
      longitude: ro,
      current: 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide',
      hourly: 'us_aqi',
      forecast_hours: '24',
      timezone: 'auto',
    });
    const data = await fetchJson(`${AQ_URL}?${params}`, fetchImpl);
    const c = data.current || {};
    if (typeof c.us_aqi !== 'number') throw new Error('Air quality data unavailable for this location');

    const times = data.hourly?.time || [];
    const values = data.hourly?.us_aqi || [];
    const result = {
      aqi: c.us_aqi,
      pm25: c.pm2_5,
      pm10: c.pm10,
      no2: c.nitrogen_dioxide,
      o3: c.ozone,
      co: c.carbon_monoxide,
      time: c.time,
      hourly: times.map((t, i) => ({ time: t, aqi: values[i] })).filter((h) => typeof h.aqi === 'number'),
    };
    cache.set(key, result);
    return result;
  }

  /** Resolve a place name to up to five coordinate matches. */
  async function geocode(name) {
    const key = `geo:${name.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const params = new URLSearchParams({ name, count: '5', language: 'en', format: 'json' });
    const data = await fetchJson(`${GEO_URL}?${params}`, fetchImpl);
    const results = (data.results || []).map((r) => ({
      name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude,
    }));
    cache.set(key, results);
    return results;
  }

  return { getAirQuality, geocode };
}

module.exports = { createAirQualityClient };
