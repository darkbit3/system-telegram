const normalizeBaseUrl = (value) => {
  if (!value) return 'http://localhost:5000';
  return String(value).trim().replace(/\/+$/, '');
};

const BACKEND_URL = normalizeBaseUrl(
  process.env.BACKEND_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.VITE_BACKEND_URL ||
  'http://localhost:5000'
);

module.exports = {
  BACKEND_URL,
  normalizeBaseUrl
};
