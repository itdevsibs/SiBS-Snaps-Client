export function getPhotoLoadStatus({ loaded, failed }) {
  if (failed) return 'error';
  return loaded ? 'loaded' : 'loading';
}

export function shouldShowPhotoLoader({ loaded, failed, previewLoaded }) {
  return !loaded && !failed && !previewLoaded;
}
