/* config.js — defaults for this deployment.
 * Leave apiKey empty when the site is public: the user pastes the key once in 设置 and it stays on the phone.
 * Only fill it in for a private deployment (e.g. reachable only inside your own Tailscale network). */
window.GLM_CONFIG = {
  apiKey: '',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  model: 'glm-5.3-flash',
};
