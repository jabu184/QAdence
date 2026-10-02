const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./db');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes - prevent any caching of API responses
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}, apiRouter);

// Serve client in production if built
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(clientDist, 'index.html'), err => {
      if (err) res.status(404).send('Patient QA Analytics Server is running. Client frontend not built yet.');
    });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Patient QA Analytics Server running on port ${PORT}`);
  console.log(`API Status: http://localhost:${PORT}/api/status`);
  console.log(`====================================================`);
});
