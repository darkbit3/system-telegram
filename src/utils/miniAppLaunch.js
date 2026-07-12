const crypto = require('crypto');

const toBase64Url = (value) => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const createOpaqueLaunchPayload = ({ phone = '', username = '', balance = '' }, secret) => {
  if (!secret) {
    throw new Error('DAMA_LAUNCH_SECRET is not configured');
  }

  const payload = Buffer.from(
    JSON.stringify({
      phone: String(phone ?? ''),
      username: String(username ?? ''),
      balance: String(balance ?? ''),
    })
  );

  const encodedPayload = toBase64Url(payload);
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64');
  const encodedSignature = toBase64Url(Buffer.from(signature));

  return `${encodedPayload}.${encodedSignature}`;
};

const buildMiniAppLaunchUrl = ({ baseUrl, gameToken, launchData, secret }) => {
  if (!baseUrl || !gameToken) {
    return null;
  }

  let launch = null;
  try {
    launch = createOpaqueLaunchPayload(launchData || {}, secret);
  } catch (error) {
    return null;
  }

  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}token=${encodeURIComponent(gameToken)}&launch=${encodeURIComponent(launch)}`;
};

module.exports = {
  createOpaqueLaunchPayload,
  buildMiniAppLaunchUrl,
};
