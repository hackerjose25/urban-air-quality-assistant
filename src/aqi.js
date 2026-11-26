'use strict';

/**
 * Pure domain logic: AQI categorisation, rule-based advice and impact estimates.
 * No I/O here, so everything is easy to unit-test.
 */

/** US EPA AQI bands. */
const AQI_BANDS = Object.freeze([
  { max: 50, level: 'good', label: 'Good', color: '#2e7d32' },
  { max: 100, level: 'moderate', label: 'Moderate', color: '#8a6d00' },
  { max: 150, level: 'sensitive', label: 'Unhealthy for Sensitive Groups', color: '#b35400' },
  { max: 200, level: 'unhealthy', label: 'Unhealthy', color: '#c62828' },
  { max: 300, level: 'very_unhealthy', label: 'Very Unhealthy', color: '#6a1b9a' },
  { max: Infinity, level: 'hazardous', label: 'Hazardous', color: '#4e0d1c' },
]);

/**
 * @param {number} aqi
 * @returns {{level:string,label:string,color:string}}
 */
function categorize(aqi) {
  if (typeof aqi !== 'number' || !Number.isFinite(aqi) || aqi < 0) {
    throw new TypeError('AQI must be a non-negative finite number');
  }
  const { level, label, color } = AQI_BANDS.find((b) => aqi <= b.max);
  return { level, label, color };
}

const SENSITIVE = new Set(['children', 'elderly', 'asthma', 'heart', 'pregnant']);

/**
 * Conservative reduction factors drawn from published studies:
 * a HEPA purifier sized to the room cuts indoor PM2.5 by about 50%,
 * sealing gaps and keeping windows shut cuts it by about 20%,
 * and a well-fitted N95 filters 90% or more.
 */
const IMPACT = Object.freeze({
  hepa: 0.5,
  sealing: 0.2,
  n95: 0.9,
  carKgPerKm: 0.17, // average petrol car, kg CO2 per km
  busKgPerKm: 0.08,
  metroKgPerKm: 0.03,
});

function round(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Estimate the CO2 saved by switching a car commute to another mode.
 * @param {number} km one-way commute distance
 * @param {'walk'|'cycle'|'bus'|'metro'} mode
 * @param {number} [daysPerWeek=5]
 */
function commuteImpact(km, mode, daysPerWeek = 5) {
  if (!(km >= 0) || !(daysPerWeek >= 0 && daysPerWeek <= 7)) {
    throw new RangeError('Invalid commute parameters');
  }
  const perKm = { walk: 0, cycle: 0, bus: IMPACT.busKgPerKm, metro: IMPACT.metroKgPerKm }[mode];
  if (perKm === undefined) throw new RangeError(`Unknown mode: ${mode}`);
  const weeklyKm = km * 2 * daysPerWeek;
  const savedKgPerWeek = (IMPACT.carKgPerKm - perKm) * weeklyKm;
  return {
    weeklyKm: round(weeklyKm),
    co2SavedKgPerWeek: round(savedKgPerWeek),
    co2SavedKgPerYear: round(savedKgPerWeek * 52),
  };
}

/**
 * Estimated indoor PM2.5 after applying measures (multiplicative reductions).
 * @param {number} outdoorPm25 µg/m³
 * @param {{hepa?:boolean, sealing?:boolean}} measures
 */
function indoorPm25(outdoorPm25, measures = {}) {
  if (!(outdoorPm25 >= 0)) throw new RangeError('PM2.5 must be >= 0');
  let v = outdoorPm25 * 0.8; // baseline infiltration
  if (measures.sealing) v *= 1 - IMPACT.sealing;
  if (measures.hepa) v *= 1 - IMPACT.hepa;
  return round(v);
}

const item = (title, detail, impact) => ({ title, detail, impact });

/**
 * Deterministic rule-based advice. This is the fallback when no LLM is
 * configured, and it is also passed to the LLM as grounding.
 * @param {{aqi:number, pm25?:number}} air
 * @param {{household?:string[], commuteKm?:number, commuteMode?:string, hasPurifier?:boolean}} profile
 */
function ruleBasedAdvice(air, profile = {}) {
  const cat = categorize(air.aqi);
  const household = (profile.household || []).filter((h) => SENSITIVE.has(h));
  const sensitive = household.length > 0;
  const severe = ['unhealthy', 'very_unhealthy', 'hazardous'].includes(cat.level);
  const elevated = severe || cat.level === 'sensitive';
  const pm = typeof air.pm25 === 'number' ? air.pm25 : null;

  const routines = [];
  const indoor = [];
  const sustainable = [];

  if (severe || (elevated && sensitive)) {
    routines.push(item(
      'Move outdoor activity indoors',
      'Do exercise and play indoors today. If you have to go out, early afternoon is usually best, when winter inversions are weakest.',
      'Lowers the pollution you breathe in; breathing rate during exercise is 3–5 times the resting rate.',
    ));
    routines.push(item(
      'Wear a well-fitted N95/FFP2 outdoors',
      'Cloth and surgical masks do little against PM2.5.',
      `Filters about ${IMPACT.n95 * 100}% of fine particles when sealed properly.`,
    ));
  } else if (elevated) {
    routines.push(item(
      'Keep outdoor exercise light and short',
      'Choose parks away from main roads and avoid rush hours.',
      'PM levels next to a busy road can be twice those one block away.',
    ));
  } else {
    routines.push(item(
      'Good time for outdoor activities',
      'The air is fairly clean right now, so it is a good moment to air out your home and exercise outside.',
      'Clears out indoor pollutants that build up overnight.',
    ));
  }

  if (elevated) {
    indoor.push(item(
      profile.hasPurifier ? 'Run your purifier on high in the main room' : 'Build a DIY box-fan filter',
      profile.hasPurifier
        ? 'Close the door and leave the purifier running all the time.'
        : 'Tape a MERV-13 furnace filter to a box fan. It costs a fraction of a commercial purifier.',
      pm !== null
        ? `Indoor PM2.5 should fall from about ${indoorPm25(pm)} to about ${indoorPm25(pm, { hepa: true, sealing: true })} µg/m³ if you also seal gaps.`
        : 'Can roughly halve indoor PM2.5 in a closed room.',
    ));
    indoor.push(item(
      'Seal gaps and keep windows shut',
      'Put draught strips on windows and doors. Air out the home briefly only when the AQI drops.',
      'Cuts the outdoor air leaking in by about 20%.',
    ));
    indoor.push(item(
      'Avoid burning anything indoors',
      'Skip incense, candles and wood or coal heaters, and run the extractor hood while cooking.',
      'Burning things indoors can add as much PM2.5 as a smoggy day outside.',
    ));
  } else {
    indoor.push(item(
      'Air out the home for 10 minutes',
      'Open windows on opposite sides to let stale indoor air out.',
      'Lowers indoor CO₂ and VOCs.',
    ));
  }

  const km = Number(profile.commuteKm) || 0;
  if (profile.commuteMode === 'car' && km > 0) {
    const mode = km <= 3 ? 'walk' : km <= 8 ? 'cycle' : 'metro';
    const label = { walk: 'walking', cycle: 'cycling', metro: 'public transport' }[mode];
    const imp = commuteImpact(km, mode);
    sustainable.push(item(
      `Try ${label} for your ${km} km commute`,
      severe && mode !== 'metro'
        ? 'The air is too polluted for walking or cycling today. Take public transport now and switch on cleaner days.'
        : 'Even 2–3 days a week makes a difference.',
      `Saves about ${imp.co2SavedKgPerWeek} kg CO₂ per week (${imp.co2SavedKgPerYear} kg per year) and cuts local NO₂ and PM.`,
    ));
  }
  sustainable.push(item(
    'Avoid idling and burning waste or leaves',
    'Switch off the engine at signals longer than 10 seconds, and report open burning.',
    'Open burning is a major source of winter PM2.5 in many cities.',
  ));

  return {
    summary: `Air quality is ${cat.label} (AQI ${Math.round(air.aqi)}).${sensitive ? ` Take extra care for: ${household.join(', ')}.` : ''}`,
    category: cat,
    routines,
    indoor,
    sustainable,
    source: 'rules',
  };
}

module.exports = { categorize, commuteImpact, indoorPm25, ruleBasedAdvice, AQI_BANDS, IMPACT, SENSITIVE };
