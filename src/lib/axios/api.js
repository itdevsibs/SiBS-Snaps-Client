import axios from 'axios';

// The web app and API share one public origin. Vite proxies /api to the
// localhost:5001 backend during development; production Nginx proxies /api
// to the SiBS-Snaps server container. Never embed a browser-local API port
// or a tunnel address in the production bundle.
const api = axios.create({
  baseURL: '',
  withCredentials: true,
  timeout: 30000,
});

export default api;
