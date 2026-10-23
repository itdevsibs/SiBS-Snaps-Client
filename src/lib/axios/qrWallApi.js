/** Public photo wall adapter using the same Axios pattern as SiBS HRIS. */
export function createQrWallApi(http) {
  if (!http?.get || !http?.post || !http?.patch) {
    throw new Error('Pass the existing HRIS Axios instance to createQrWallApi');
  }
  const base = (http.defaults?.baseURL || '').replace(/\/+$/, '');
  const prefix = /\/api$/.test(base) ? '/qr-wall' : '/api/qr-wall';
  const apiUrl = suffix => new URL(`${base}${prefix}${suffix}`, window.location.origin).href;
  const request = async promise => (await promise).data;
  // Never send /public/undefined requests. A guest URL MUST have a real event token.
  const safeToken = value => {
    const token = typeof value === 'string' ? value.trim() : '';
    if (!/^[0-9a-f]{48}$/i.test(token)) {
      throw new Error('Invalid photo wall QR link. Please scan the QR code again.');
    }
    return encodeURIComponent(token);
  };

  // Device identity is an anonymous random browser-local token, not a user account.
  // A device can hold one heart per photo; guests may remove and add it again.
  // The server enforces ONE active reaction per device token with a UNIQUE key.
  const reactionDeviceKey = 'sibs-snaps-reaction-device-v1';
  function reactionDeviceHeader() {
    try {
      let token = window.localStorage.getItem(reactionDeviceKey);
      if (!/^[a-f0-9]{64}$/i.test(token || '')) {
        if (!window.crypto?.getRandomValues) return {};
        const bytes = window.crypto.getRandomValues(new Uint8Array(32));
        token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        window.localStorage.setItem(reactionDeviceKey, token);
      }
      return { 'X-SiBS-Snaps-Device': token };
    } catch { // Private mode / disabled storage: never silently invent a new ID on each click.
      return {};
    }
  }

  return {
    moderatorLogin: (sibsId, password) => request(http.post(`${prefix}/moderator/login`, { sibsId, password })),
    moderatorMe: () => request(http.get(`${prefix}/moderator/me`)),
    moderatorLogout: () => request(http.post(`${prefix}/moderator/logout`, {})),
    moderatorPhotos: (status = 'pending', before = null, page = 1, limit = 25) => request(http.get(`${prefix}/moderator/photos`, { params: { status, ...(before ? { before } : {}), ...(page ? { page } : {}), ...(limit ? { limit } : {}) } })),
    moderatorDecision: (id, decision) => request(http.post(`${prefix}/moderator/photos/${encodeURIComponent(id)}/decision`, { decision })),
    moderatorDelete: id => request(http.delete(`${prefix}/moderator/photos/${encodeURIComponent(id)}`)),
    moderatorDeleteBatch: (status, upToId = null) => request(http.delete(`${prefix}/moderator/photos`, {
      params: { status, ...(upToId ? { upToId } : {}) },
    })),
    moderatorRetryDeletionCleanup: () => request(http.post(`${prefix}/moderator/photos/deletion-cleanup`, {})),
    moderatorPhotoUrl: (id, variant = 'feed') => {
      const size = ['thumbnail', 'feed', 'large'].includes(variant) ? variant : 'feed';
      return apiUrl(`/moderator/photos/${encodeURIComponent(id)}/image?variant=${size}`);
    },
    moderatorDownload: async id => (await http.get(`${prefix}/moderator/photos/${encodeURIComponent(id)}/download`, { responseType: 'blob' })).data,
    getActive: (options = {}) => request(http.get(`${prefix}/public/active`, { signal: options?.signal })),
    getEvent: (token, options = {}) => request(http.get(`${prefix}/public/${safeToken(token)}`, { signal: options?.signal })),
    getPhotos: (token, cursor = null, limit = 10, options = {}) => {
      const params = { limit, ...(cursor ? { cursor } : {}) };
      return request(http.get(`${prefix}/public/${safeToken(token)}/photos`, {
        params,
        headers: reactionDeviceHeader(),
        signal: options?.signal,
      })).catch(err => {
        if (err?.response?.status === 404 && http.get) {
          return request(http.get(`${prefix}/public/${safeToken(token)}/feed`, {
            params: { limit, ...(cursor ? { before: cursor } : {}) },
            headers: reactionDeviceHeader(),
            signal: options?.signal,
          }));
        }
        throw err;
      });
    },
    getFeed: (token, before, limit = 30, options = {}) => request(http.get(`${prefix}/public/${safeToken(token)}/feed`, {
      params: { limit, ...(before ? { before } : {}) },
      headers: reactionDeviceHeader(),
      signal: options?.signal,
    })),
    react: (token, photoId) => {
      const headers = reactionDeviceHeader();
      if (!headers['X-SiBS-Snaps-Device']) {
        return Promise.reject(new Error('Allow browser storage to keep your reaction on this device.'));
      }
      return request(http.post(`${prefix}/public/${safeToken(token)}/photos/${encodeURIComponent(photoId)}/reactions`, {}, { headers }));
    },
    unreact: (token, photoId) => {
      const headers = reactionDeviceHeader();
      if (!headers['X-SiBS-Snaps-Device']) {
        return Promise.reject(new Error('Allow browser storage to manage your reaction on this device.'));
      }
      return request(http.delete(`${prefix}/public/${safeToken(token)}/photos/${encodeURIComponent(photoId)}/reactions`, { headers }));
    },
    getComments: (token, photoId, before) => request(http.get(
      `${prefix}/public/${safeToken(token)}/photos/${photoId}/comments`, { params: before ? { before } : {} },
    )),
    upload: (token, { photos, author, caption }) => {
      const body = new FormData();
      body.append('author', author);
      body.append('caption', caption || '');
      photos.forEach(photo => body.append('photos', photo));
      // Let the browser set the multipart boundary. Do not set Content-Type manually.
      return request(http.post(`${prefix}/public/${safeToken(token)}/photos`, body, { timeout: 120000 }));
    },
    comment: (token, photoId, author, body) => request(http.post(
      `${prefix}/public/${safeToken(token)}/photos/${photoId}/comments`, { author, body },
    )),
    imageUrl: (token, id) => apiUrl(`/public/${safeToken(token)}/photos/${id}/image`),
    qrUrl: token => apiUrl(`/public/${safeToken(token)}/qr.svg`),
    streamUrl: token => apiUrl(`/public/${safeToken(token)}/stream`),
    activeStreamUrl: () => apiUrl('/public/active/stream'),
  };
}

export function isCancelError(error) {
  if (!error) return false;
  return Boolean(
    error?.name === 'CanceledError' ||
    error?.name === 'AbortError' ||
    error?.code === 'ERR_CANCELED' ||
    error?.message === 'canceled' ||
    error?.__CANCEL__
  );
}

export function readableQrWallError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error || isCancelError(error)) return '';
  return error?.response?.data?.message || (error?.message && error.message !== 'canceled' ? error.message : fallback);
}

export function readableUploadError(error) {
  if (['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) || [408, 504].includes(error?.response?.status)) {
    return 'The upload timed out. Your photo may still have been submitted. Please check with the moderator before retrying.';
  }
  return readableQrWallError(error, 'Photo upload failed. Your selection is still available for retry.');
}
