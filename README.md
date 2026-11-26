# Urban Air Quality Assistant

**Live demo:** https://hack2skill-challenge6.vercel.app

A GenAI-powered assistant that helps families and communities get through severe winter smog and urban air pollution. It combines **live air quality data** with **Google Gemini** to suggest:

- **Low-exposure daily routines**: when to go out, how to exercise and commute, and which masks actually work
- **Indoor air quality tips**: purifiers, DIY box-fan filters, sealing gaps, avoiding indoor burning
- **Sustainable alternatives**: switching your commute to cleaner options, cutting local emissions

Each suggestion explains its **direct impact**, for example: *"Indoor PM2.5 should fall from about 144 to about 58 µg/m³"* or *"Saves about 14 kg CO₂ per week"*.

## How it works

```
Browser ──► Express API ──► Open-Meteo Air Quality (live AQI, PM2.5, PM10, NO₂, O₃, 24 h forecast)
                │
                ├─► Rule engine (deterministic, quantified advice)  ──┐
                │                                                     ├─► Personalised plan
                └─► Gemini (grounded on live data and rule baseline) ─┘
```

1. The user picks a location (city search or browser geolocation, rounded to about 1 km) and describes their household (children, elderly, asthma, and so on), commute and whether they own a purifier.
2. The server fetches current air quality and a 24-hour forecast from Open-Meteo (CAMS data, no key needed).
3. A **rule engine** produces quantified baseline advice based on US EPA AQI bands and published reduction factors.
4. If `GEMINI_API_KEY` is set, **Gemini** turns that into advice tailored to the location and household, using strict JSON output. If Gemini is unavailable, the app falls back to the rule engine, so it never fails without an answer.

## Run locally

```bash
npm install
cp .env.example .env    # optional: add GEMINI_API_KEY
GEMINI_API_KEY=your_key npm start
# open http://localhost:8080
```

Without a key, the app still works using the rule engine.

## Test

```bash
npm test
```

The tests use Node's built-in test runner (no extra dependencies) and cover AQI categorisation, impact calculations, input validation, LLM output parsing, caching, the API routes, security headers, rate limiting and error handling. All network calls are injected and mocked.

## Deploy (Vercel)

Import the repo at vercel.com/new and add `GEMINI_API_KEY` under Environment Variables. `vercel.json` serves `public/` from Vercel's CDN (with the same security headers) and routes `/api/*` to the Express app in `api/index.js`.

## Deploy (Google Cloud Run)

```bash
gcloud run deploy urban-air --source . --set-env-vars GEMINI_API_KEY=your_key --allow-unauthenticated
```

## Design notes

| Area | What we did |
|---|---|
| **Security** | The API key stays server-side and is sent as a header, never in the URL. Helmet sets a strict CSP. Requests are rate-limited, JSON bodies are capped at 10 KB, and every input field is whitelisted and sanitised before reaching the prompt. The system prompt hardens against prompt injection, and model output is validated and clipped. The frontend renders text with `textContent` only. Upstream errors are not leaked to clients. The container runs as a non-root user. |
| **Efficiency** | A TTL and LRU cache sits in front of upstream APIs, and coordinates are rounded to improve cache hits. Gemini is called over REST with no SDK, and there are only 3 runtime dependencies. The frontend is static, with no framework or build step. Upstream calls have timeouts. |
| **Accessibility** | Semantic landmarks, a skip link, labelled fieldsets, `aria-live` status announcements, `role="alert"` errors, visible focus rings, 44 px touch targets, a text alternative for the forecast chart, dark mode, reduced-motion support, and focus moves to the results when they load. |
| **Code quality** | Pure domain logic (`aqi.js`) is separated from I/O. The app factory uses dependency injection, and modules are small with JSDoc comments. |
| **Testing** | 30+ unit and integration tests run with no network access. |

## Project structure

```
src/
  app.js         Express app factory (routes, security, errors)
  aqi.js         AQI bands, impact maths, rule-based advice
  airQuality.js  Open-Meteo air quality and geocoding client with caching
  gemini.js      Gemini prompt, call and output validation
  validate.js    Request validation and sanitising
  cache.js       TTL/LRU cache
public/          Accessible vanilla HTML/CSS/JS frontend
test/            node:test suites
```

*This app gives general guidance, not medical advice.*
