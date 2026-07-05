const express = require('express');
const cors = require('cors');
const config = require('./config');
const incidentsRouter = require('./routes/incidents');
const volunteersRouter = require('./routes/volunteers');
const resourcesRouter = require('./routes/resources');
const triageRouter = require('./routes/triage');
const dispatchRouter = require('./routes/dispatch');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/api/incidents', incidentsRouter);
app.use('/api/volunteers', volunteersRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/triage', triageRouter);
app.use('/api/dispatch', dispatchRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ResQNet Backend' });
});

app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`ResQNet backend running on port ${config.port}`);
});
