'use strict';

const { createApp } = require('./app');

const port = Number(process.env.PORT) || 8080;
createApp().listen(port, () => {
  console.log(`Urban Air Quality Assistant running on http://localhost:${port}`);
});
