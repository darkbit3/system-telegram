const normalizeBaseUrl = (value) => {
  if (!value) return null;
  return String(value).trim().replace(/\/+$/, '');
};

const BACKEND_URL =
  normalizeBaseUrl(process.env.BACKEND_URL) ||
  normalizeBaseUrl(process.env.RENDER_EXTERNAL_URL) ||
  normalizeBaseUrl(process.env.VITE_BACKEND_URL) ||
  'http://localhost:5000';

// Warn loudly on startup if still pointing at localhost in a non-local env
if (
  BACKEND_URL.includes('localhost') &&
  process.env.RENDER
) {
  console.warn(
    '[WARN] BACKEND_URL is set to localhost but this process is running on Render.\n' +
    '       Set BACKEND_URL in your Render environment variables to the deployed backend URL.\n' +
    '       Example: https://your-backend.onrender.com'
  );
}

module.exports = { BACKEND_URL, normalizeBaseUrl };
