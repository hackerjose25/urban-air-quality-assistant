'use strict';

// Load .env for local development if present (Node >= 20.12). In production, use real env vars.
try {
  process.loadEnvFile();
} catch {
  /* no .env file: rely on the environment */
}

const { createApp } = require('./app');

const port = Number(process.env.PORT) || 8080;
createApp().listen(port, () => {
  console.log(`Urban Air Quality Assistant running on http://localhost:${port}`);
});
