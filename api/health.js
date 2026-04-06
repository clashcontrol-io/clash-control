// ClashControl — Health check endpoint
// Returns AI and DB connection status

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  var status = { ai: false, db: false, model: null };

  // Check AI (Google AI Studio / Gemma 4)
  if (process.env.GOOGLE_AI_KEY) {
    status.ai = true;
    status.model = 'gemma-4-27b-it';
  }

  // Check DB (Neon Postgres)
  if (process.env.DATABASE_URL) {
    try {
      var { neon } = require('@neondatabase/serverless');
      var sql = neon(process.env.DATABASE_URL);
      await sql`SELECT 1`;
      status.db = true;
    } catch (e) {
      status.db = false;
    }
  }

  res.status(200).json(status);
};
