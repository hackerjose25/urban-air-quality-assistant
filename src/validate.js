'use strict';

const HOUSEHOLD = ['children', 'elderly', 'asthma', 'heart', 'pregnant', 'adults'];
const MODES = ['car', 'bus', 'metro', 'cycle', 'walk', 'wfh'];
const TEXT_RE = /[^\p{L}\p{N} ,.'-]/gu;

/** Strip everything except letters, digits and basic punctuation. */
function cleanText(s, max = 80) {
  return typeof s === 'string' ? s.replace(TEXT_RE, '').trim().slice(0, max) : '';
}

/**
 * Validate and normalise the advice request body. Every field is whitelisted,
 * so nothing unexpected reaches the LLM prompt (prompt-injection hardening).
 * @returns {{ok:true,value:object}|{ok:false,error:string}}
 */
function validateAdviceRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (body.lat === undefined || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, error: 'lat must be between -90 and 90' };
  }
  if (body.lon === undefined || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { ok: false, error: 'lon must be between -180 and 180' };
  }

  const household = Array.isArray(body.household)
    ? [...new Set(body.household.filter((h) => HOUSEHOLD.includes(h)))]
    : [];
  const commuteMode = MODES.includes(body.commuteMode) ? body.commuteMode : 'wfh';
  const commuteKm = Number(body.commuteKm ?? 0);
  if (!Number.isFinite(commuteKm) || commuteKm < 0 || commuteKm > 200) {
    return { ok: false, error: 'commuteKm must be between 0 and 200' };
  }

  return {
    ok: true,
    value: {
      lat,
      lon,
      city: cleanText(body.city),
      household,
      commuteMode,
      commuteKm: Math.round(commuteKm * 10) / 10,
      hasPurifier: body.hasPurifier === true,
    },
  };
}

/** @returns {string|null} a cleaned query, or null if it is too short */
function validateCityQuery(q) {
  const clean = cleanText(q);
  return clean.length >= 2 ? clean : null;
}

module.exports = { validateAdviceRequest, validateCityQuery, HOUSEHOLD, MODES };
