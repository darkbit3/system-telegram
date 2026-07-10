const normalizeBaseUrl = (value) => {
  if (!value) return null;
  return String(value).trim().replace(/\/+$/, '');
};

// Production URL — always use the deployed backend
const BACKEND_URL =
  normalizeBaseUrl(process.env.BACKEND_URL) ||
  'https://system-backend-jbnd.onrender.com';

// Warn if still pointing at localhost in a Render environment
if (BACKEND_URL.includes('localhost') && process.env.RENDER) {
  console.warn(
    '[WARN] BACKEND_URL is localhost but running on Render.\n' +
    '       Set BACKEND_URL=https://system-backend-jbnd.onrender.com in Render env vars.'
  );
}

module.exports = { BACKEND_URL, normalizeBaseUrl };
