import { isConfirmedPhotoUpload } from './qrWallUploadConfirmation.js';
import {
  isUncertainUploadError,
  reconcileUploadStatus,
  uploadProgressLabel,
} from './qrWallUploadReliability.js';
import { preparePhotoUpload } from './optimizePhotoForUpload.js';

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

async function confirmQueueItem(item, { uploadStatus, reconcile, onProgress }) {
  await onProgress({ status: 'confirming', progress: 'Confirming upload status…', error: '' });
  const checkStatus = () => uploadStatus(item.eventToken, item.requestId);
  const status = await reconcile({ requestId: item.requestId, checkStatus });

  if (status?.state === 'committed') return { outcome: 'committed', status };
  if (status?.state === 'failed') {
    return {
      outcome: 'failed',
      error: 'The server confirmed that this upload failed. Tap Retry to upload it again.',
    };
  }
  if (status?.state === 'processing') {
    return {
      outcome: 'uncertain',
      error: 'The server is still processing this photo. Tap Check status shortly.',
    };
  }

  // Distinguish a confirmed "unknown" response from an unreachable status
  // endpoint before ever permitting a retry.
  try {
    const finalStatus = await checkStatus();
    if (finalStatus?.state === 'committed') return { outcome: 'committed', status: finalStatus };
    if (finalStatus?.state === 'failed') {
      return { outcome: 'failed', error: 'The server confirmed that this upload failed. Tap Retry to upload it again.' };
    }
    if (finalStatus?.state === 'unknown') {
      return { outcome: 'failed', error: 'The server has no record of this upload. Tap Retry to send it safely.' };
    }
  } catch {
    // The result remains uncertain while status cannot be reached.
  }
  return {
    outcome: 'uncertain',
    error: 'The connection ended before confirmation. Tap Check status; the photo will not be uploaded twice.',
  };
}

export async function processUploadQueueItem(item, {
  optimize = preparePhotoUpload,
  upload,
  uploadStatus,
  reconcile = reconcileUploadStatus,
  onProgress = () => {},
}) {
  if (item.status === 'needs-check') {
    return confirmQueueItem(item, { uploadStatus, reconcile, onProgress });
  }

  try {
    await onProgress({ status: 'optimizing', progress: 'Optimizing photo…', error: '' });
    const prepared = await optimize({ file: item.file, requestId: item.requestId });
    // Persist the uploading state before the request starts. A reload can then
    // reconcile this request ID instead of blindly sending the file again.
    await onProgress({ status: 'uploading', progress: 'Uploading photo…', error: '' });
    const response = await upload(item.eventToken, {
      author: item.author,
      caption: item.caption,
      photos: [prepared.file],
      requestId: prepared.requestId,
      onUploadProgress: event => onProgress({
        status: 'uploading',
        progress: uploadProgressLabel(event),
        error: '',
        persist: false,
      }),
    });

    if (isConfirmedPhotoUpload(response)) return { outcome: 'committed', response };
    if (response?.state === 'processing') {
      return confirmQueueItem(item, { uploadStatus, reconcile, onProgress });
    }
    return {
      outcome: 'failed',
      error: 'The server did not confirm this upload. Tap Retry after checking with the moderator.',
    };
  } catch (error) {
    if (isUncertainUploadError(error)) {
      return confirmQueueItem(item, { uploadStatus, reconcile, onProgress });
    }
    return {
      outcome: 'failed',
      error: errorMessage(error, 'Photo upload failed. Tap Retry to try again.'),
    };
  }
}
