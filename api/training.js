// ClashControl — Training data ingestion endpoint
// Replaces Google Forms beacons with proper Postgres storage

const ALLOWED_ORIGINS = [
  'https://www.clashcontrol.io',
  'http://localhost:3000',
  'http://localhost:5500',
];

function cors(req, res) {
  var origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CC-Consent');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// Simple in-memory rate limiter (resets per cold start, good enough)
var rateMap = {};
function rateLimit(ip, limit) {
  var now = Date.now();
  var bucket = rateMap[ip];
  if (!bucket || now - bucket.start > 60000) {
    rateMap[ip] = { start: now, count: 1 };
    return false;
  }
  bucket.count++;
  return bucket.count > limit;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Require consent header
  if (req.headers['x-cc-consent'] !== 'true') {
    return res.status(403).json({ error: 'Consent required' });
  }

  // Rate limit: 10 requests/min per IP
  var ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (rateLimit(ip, 10)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  var dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(503).json({ error: 'Database not configured' });

  var body = req.body;
  if (!body || !body.type) return res.status(400).json({ error: 'Missing type' });

  try {
    var { neon } = require('@neondatabase/serverless');
    var sql = neon(dbUrl);

    switch (body.type) {
      case 'nl_command': {
        // NL command training data
        await sql`INSERT INTO nl_training (input, matched, action, path, feedback_type, correction_input, correction_intent, confidence, app_version)
          VALUES (${body.input || ''}, ${!!body.matched}, ${body.action || null}, ${body.path || null}, ${body.feedbackType || null}, ${body.correctionInput || null}, ${body.correctionIntent || null}, ${body.confidence || null}, ${body.appVersion || null})`;
        break;
      }
      case 'clash_feedback': {
        // Clash labeling / training mode data
        await sql`INSERT INTO clash_training (clash_id, feature_vector, label, label_source, app_version)
          VALUES (${body.clashId || ''}, ${JSON.stringify(body.featureVector || {})}, ${body.label || ''}, ${body.labelSource || 'user'}, ${body.appVersion || null})`;
        break;
      }
      case 'detection_run': {
        // Detection run summary
        await sql`INSERT INTO detection_runs (run_id, model_count, clash_count, hard_count, soft_count, duplicate_count, duration_ms, rules, app_version)
          VALUES (${body.runId || ''}, ${body.modelCount || 0}, ${body.clashCount || 0}, ${body.hardCount || 0}, ${body.softCount || 0}, ${body.duplicateCount || 0}, ${body.durationMs || 0}, ${JSON.stringify(body.rules || {})}, ${body.appVersion || null})`;
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown type: ' + body.type });
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Training data error:', e);
    res.status(500).json({ error: 'Database error' });
  }
};
