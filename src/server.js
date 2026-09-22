require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const hpp       = require('hpp');
const logger    = require('./config/logger');
const bank      = require('./config/bank');

const app = express();

// ── Behind reverse proxy (Render/Railway/nginx) ─────────────
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ── Security headers ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS: explicit allowlist ────────────────────────────────
// Set CORS_ORIGINS in .env as comma-separated list.
// Falls back to localhost dev servers so local dev keeps working.
const rawOrigins = process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173,http://localhost:8080';
const allowedOrigins = rawOrigins.split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // allow same-origin / curl / server-to-server (no Origin header)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));

// ── Body parsing: 200kb is generous for a banking API ───────
app.use(express.json({ limit: process.env.BODY_LIMIT || '200kb' }));

// ── HTTP parameter pollution guard ──────────────────────────
app.use(hpp());

// ── Rate limiters ───────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code requests. Please wait.' },
});

const transferLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many transaction attempts. Please wait a moment.' },
});

// ── Request logger ──────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ip: req.ip,
      ms: Date.now() - start,
    });
  });
  next();
});

// ── Root ────────────────────────────────────────────────────
app.get('/', (_, res) => res.json({
  bank: bank.legalName,
  founded: bank.founded,
  yearsOfService: new Date().getFullYear() - bank.founded,
  status: 'operational',
  time: new Date().toISOString(),
}));

// ── Crypto World Alerts ──────────────────────────────────────
const { getCryptoPrices } = require('./services/crypto');
app.get('/api/crypto/alerts', globalLimiter, async (req, res) => {
  const prices = await getCryptoPrices();
  if (!prices) return res.status(500).json({ error: 'Crypto service unavailable' });
  res.json(prices);
});

// ── Routes ──────────────────────────────────────────────────
app.use('/api/bank-verify',                        require('./routes/bankVerify'));
app.use('/api/auth/login',      loginLimiter);
app.use('/api/auth/verify-otp', loginLimiter);
app.use('/api/auth/resend-otp', otpLimiter);
app.use('/api/auth',            globalLimiter,   require('./routes/auth'));
app.use('/api/accounts',                        require('./routes/accounts'));
app.use('/api/transfers',       transferLimiter, require('./routes/transfers'));
app.use('/api/admin',                           require('./routes/admin'));
app.use('/api/bills',                           require('./routes/bills'));
app.use('/api/deposits',                        require('./routes/deposits'));
app.use('/api/statements',                      require('./routes/statements'));
app.use('/api/audit',                           require('./routes/audit'));
app.use('/api/notifications',                   require('./routes/notifications'));
app.use('/api/beneficiaries',                   require('./routes/beneficiaries'));
app.use('/api/payroll',                         require('./routes/payroll'));
app.use('/api/signup',                          require('./routes/signup'));
app.use('/api/cards',                           require('./routes/cards'));
app.use('/api/direct-deposit',                  require('./routes/directDeposit'));

// ── Error handler ───────────────────────────────────────────
app.use((err, req, res, next) => {
  // CORS rejection → 403, not 500
  if (err && err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  logger.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 500 ? 'Request could not be processed.' : err.message });
});

module.exports = app;

// Only start listening when run directly (node src/server.js).
// When imported by tests, we just export the app.
const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => console.log('Continental Federal Bank API running on port ' + PORT));
}

module.exports = app;
