# Security Policy

## Reporting a vulnerability

Please open a private security advisory on this repository (Security tab, then "Report a vulnerability") instead of a public issue.

## Security measures

- **Secrets:** the Gemini API key is read from environment variables only. It is never sent to the browser or placed in URLs (it goes in the `x-goog-api-key` header). `.env` is ignored by git.
- **HTTP hardening:** Helmet sets a strict Content Security Policy (no inline scripts, `frame-ancestors 'none'`), HSTS, `nosniff` and a strict referrer policy. `x-powered-by` is disabled. Vercel's CDN sends the same headers for static files.
- **Abuse protection:** `/api/*` is limited to 30 requests per minute per IP, JSON bodies are capped at 10 KB, and every upstream call has a timeout.
- **Input validation:** every request field is whitelisted, range-checked and sanitised (`src/validate.js`). Free text is stripped down to letters, digits and basic punctuation, and capped at 80 characters.
- **Prompt-injection defence:** only validated fields reach the model. The system prompt tells it to treat user data as data. Model output must be valid JSON, and it is validated and length-clipped before use.
- **XSS:** the frontend renders all dynamic content with `textContent`, never `innerHTML`.
- **Error handling:** clients get generic error messages. Internal details are logged on the server only.
- **Privacy:** coordinates are rounded to about 1 km before leaving the server. No accounts, cookies or tracking. The household profile stays in the user's own browser (`localStorage`).
- **Supply chain:** only 3 runtime dependencies. CI runs `npm audit` on every push. The Docker image runs as a non-root user.
