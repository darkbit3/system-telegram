const buildMiniAppLaunchUrl = ({ baseUrl, gameToken, launchToken }) => {
  if (!baseUrl || !gameToken || !launchToken) {
    return null;
  }

  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}token=${encodeURIComponent(gameToken)}&launch=${encodeURIComponent(launchToken)}`;
};

module.exports = {
  buildMiniAppLaunchUrl,
};
