# 🌫️ Urban Air Quality Assistant

[![CI](https://github.com/hackerjose25/urban-air-quality-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/hackerjose25/urban-air-quality-assistant/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-49%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-99.8%25-brightgreen)
![Vulnerabilities](https://img.shields.io/badge/npm%20audit-0%20vulnerabilities-brightgreen)
![Node](https://img.shields.io/badge/node-%3E%3D20-blue)

**Live demo:** https://air-quality-assistant-jose.vercel.app/

**Demo video (2 min):** https://drive.google.com/file/d/1QS6Zei7DTGDk1x_fz26l1KA7aBi9pC8I/view?usp=sharing

A GenAI-powered assistant that helps families and communities get through **severe winter smog and urban air pollution**. It combines **live air quality data** for the user's location with **Google Gemini** to produce a personalised daily plan, and **every suggestion explains its direct impact**.

## The problem

Each winter, temperature inversions trap smog over cities such as Delhi, Lahore and Beijing, and the AQI regularly goes above 300. Families get a single AQI number but no practical guidance: *Should my child play outside? Does my purifier help? What can I change myself?*

## The solution

| Challenge requirement | How the app meets it |
|---|---|
| **GenAI-powered assistant** | Google Gemini (`gemini-3.5-flash-lite`) writes the advice, grounded on live data and a rule-based baseline. If Gemini is unavailable, the rule engine answers instead. |
| **Severe winter smog and urban pollution** | Live US AQI, PM2.5, PM10, NO₂ and O₃ from Open-Meteo (CAMS), with a 24-hour forecast highlighting the cleanest and worst hours. |
| **Low-emission daily routines** | A "Low-exposure daily routine" section: when to go out, how to exercise, which masks actually work. |
| **Indoor air quality hacks** | An "Indoor air quality tips" section: purifiers, DIY box-fan filters, sealing gaps, avoiding burning indoors. |
| **Sustainable alternatives** | A "Lower-emission alternatives" section: switching your commute to cleaner options, avoiding idling and open burning. |
| **Tailored to location and lifestyle** | City search or geolocation, plus household members (children, elderly, asthma, heart condition, pregnancy), commute mode and distance, and whether you own a purifier. |
| **Explaining the direct impact of choices** | Every suggestion has an **Impact** line with a number, e.g. *"Indoor PM2.5 should fall from about 144 to about 58 µg/m³"*, *"Saves about 16.8 kg CO₂ per week (874 kg per year)"*. |

## Architecture

```
Browser (vanilla HTML/CSS/JS, served from Vercel's CDN)
   │  POST /api/advice  { lat, lon, household, commute, purifier }
   ▼
Express API  ── helmet · rate limit · 10 KB body cap · input whitelist
   │
   ├─► Open-Meteo Air Quality + Geocoding  (TTL/LRU cache, 8 s timeout)
   │
   ├─► Rule engine (src/aqi.js)  ── deterministic, quantified advice ──┐
   │                                                                  ├─► Personalised plan
   └─► Gemini (src/gemini.js) ── grounded on live data and baseline ──┘   (validated JSON)
```

**Why two engines?** The rule engine provides correct numbers (EPA AQI bands, published reduction factors). Gemini makes the advice specific to the user. The model sees the rule engine's output as an "expert baseline", which keeps it grounded and reduces made-up claims. If Gemini times out or fails, users still get a full plan.

## Judging criteria

### ✅ Code Quality
- Clear layers: **pure domain logic** (`aqi.js`, `validate.js`) has no I/O, and I/O lives in separate client modules.
- **Dependency injection**: `createApp({ airClient, generateAdvice, … })`, so everything can be tested without network access.
- Small, single-purpose functions with JSDoc on every function: route handlers, middleware and the rule engine are split into focused units (for example `routineAdvice`, `indoorAdvice`, `sustainableAdvice`).
- **No magic numbers**: every limit, timeout and model setting lives in one frozen `src/config.js`.
- ESLint (flat config) enforces **complexity ≤ 10, max 50 lines per function, max depth 3, max 4 params**, `no-shadow` and `no-param-reassign`; it runs in CI with **0 errors**.
- Only **3 runtime dependencies**, and the frontend needs no framework or build step.

### 🔒 Security
See [SECURITY.md](SECURITY.md). In short:
- The API key stays **server-side only**, is sent as a header (never in a URL), and `.env` is ignored by git.
- **Helmet**: strict CSP (no inline scripts), HSTS, `nosniff` and `frame-ancestors 'none'`. The same headers are set on the CDN in `vercel.json`.
- **Rate limiting** (30 requests per minute per IP), **10 KB body limit** and **timeouts** on every upstream call.
- **Input whitelisting and sanitising** on every field, plus **prompt-injection defences**: only validated fields reach the model, the system prompt tells it to treat user input as data, and its output is checked against a strict JSON schema and length-clipped.
- **XSS-safe rendering** (`textContent` only), generic error messages to clients, **coordinates rounded to about 1 km** for privacy, and a non-root Docker user.
- `npm audit`: **0 vulnerabilities**, checked in CI.

### ⚡ Efficiency
- A **TTL and LRU cache** in front of upstream APIs (10 minutes). Coordinates are rounded so nearby users share cache entries.
- Static files are served from **Vercel's edge CDN**, and the serverless function handles `/api/*` only.
- Gemini is called over **REST with no SDK**, using a compact JSON prompt and `responseMimeType: application/json` so no retries are needed for parsing.
- **Fast fallback**: if Gemini fails, the precomputed rule-based answer is returned immediately.
- The frontend is about 15 KB in total, with no framework, deferred script loading and one API call per plan.

### 🧪 Testing
- **49 tests**, **99.8% line coverage**, using Node's built-in `node:test` (no test-framework dependency).
- **Unit tests:** AQI bands and edge cases, impact calculations, validation and sanitising, cache expiry and eviction, LLM output parsing.
- **Integration tests:** every API route, security headers, rate limiting (429), bad JSON (400), oversized body (413), upstream failure (502), Gemini fallback.
- **Accessibility tests:** labels, landmarks, live regions and **WCAG AA contrast ratios computed for both themes**.
- **CI:** GitHub Actions runs lint, tests with coverage and audit on Node 20 and 22 for every push.

### ♿ Accessibility (WCAG 2.2 AA)
- Semantic landmarks (`header`, `main`, `footer`), a **skip link** and one `h1` with a logical heading order.
- Every control has a `<label>`, and related checkboxes are grouped in `<fieldset>`/`<legend>`.
- **Screen reader support**: `aria-live` status messages, `role="alert"` errors, `aria-invalid` with `aria-errormessage` on fields with errors, `aria-busy` while loading, and **focus moves to the results** when they arrive.
- The forecast chart has a **text alternative** (cleanest and worst hour), so information isn't conveyed by colour alone.
- **Visible focus rings**, **44 × 44 px touch targets**, zoom allowed, **dark mode**, `prefers-reduced-motion` support, and contrast of at least 4.5:1, tested automatically.

## Run locally

```bash
git clone https://github.com/hackerjose25/urban-air-quality-assistant.git
cd urban-air-quality-assistant
npm install
cp .env.example .env          # add your GEMINI_API_KEY (from aistudio.google.com)
npm start                     # http://localhost:8080
```

The app works without a key too, using the rule engine.

| Script | What it does |
|---|---|
| `npm test` | Run all tests |
| `npm run test:coverage` | Run tests with a coverage report |
| `npm run lint` | Run ESLint |
| `npm run check` | Lint, test and audit |

## Deploy

**Vercel (live):** import the repo and set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`). `vercel.json` serves `public/` from the CDN and routes `/api/*` to `api/index.js`.

**Google Cloud Run:**
```bash
gcloud run deploy urban-air --source . --set-env-vars GEMINI_API_KEY=your_key --allow-unauthenticated
```

## Project structure

```
api/index.js         Vercel serverless entry point
src/
  app.js             Express app factory: routes, security, error handling
  aqi.js             AQI bands, impact calculations, rule-based advice (pure)
  airQuality.js      Open-Meteo air quality and geocoding client, with caching
  gemini.js          Gemini prompt, REST call and output validation
  validate.js        Request whitelisting and sanitising (pure)
  cache.js           TTL/LRU cache
  config.js          All limits, timeouts and model settings (frozen)
  index.js           Local server entry point
public/              Accessible vanilla HTML, CSS and JS frontend
test/                49 node:test tests (unit, integration, accessibility)
.github/workflows/   CI: lint, test, coverage, audit
```

## Data sources and assumptions

- **Air quality:** [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) (Copernicus CAMS model, US AQI scale).
- **Impact factors** (deliberately conservative): HEPA purifier about 50% reduction in indoor PM2.5; sealing gaps and closing windows about 20%; N95 filtration about 90%; car 0.17, bus 0.08 and metro 0.03 kg CO₂ per km.

*This app gives general guidance, not medical advice.*

## License

MIT
