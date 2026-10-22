import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, CheckCircle2, ImagePlus, Send, UploadCloud } from 'lucide-react';
import PhotoPost from '../../components/qr-wall/PhotoPost';
import { readableQrWallError } from '../../lib/axios/qrWallApi';
import './qrWall.css';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // Exactly 10 MiB per individual file
// Exactly one photo per submission; guests may create unlimited submissions.

export default function QRWallJoinPage({ api, token }) {
  // The :token router parameter must be forwarded by the parent route. Fall back
  // to the actual URL so the guest page still works with older App.jsx versions.
  const { token: routeToken } = useParams();
  const urlToken = window.location.pathname.match(/\/photo-wall\/join\/([0-9a-f]{48})(?:\/|$)/i)?.[1];
  const wallToken = [token, routeToken, urlToken]
    .find(value => typeof value === 'string' && /^[0-9a-f]{48}$/i.test(value)) || null;
  const [event, setEvent] = useState(null);
  const moderationRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [name, setName] = useState(() => sessionStorage.getItem('qr-wall-guest-name') || '');
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState('');
  const [caption, setCaption] = useState('');
  const [tab, setTab] = useState('feed');
  const [busy, setBusy] = useState(false);
  const [reactBusyIds, setReactBusyIds] = useState(() => new Set());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const previews = useMemo(() => files.slice(0, 1).map(file => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach(item => URL.revokeObjectURL(item.url)), [previews]);

  const refresh = useCallback(async () => {
    if (!wallToken) return;
    const response = await api.getFeed(wallToken, null, 30);
    setEvent(response.event);
    const moderationChanged = moderationRef.current !== null && moderationRef.current !== response.event.moderationRevision;
    moderationRef.current = response.event.moderationRevision;
    if (moderationChanged) setCursor(response.nextCursor);
    setPhotos(previous => {
      if (moderationChanged) return response.photos;
      const seen = new Set(response.photos.map(photo => String(photo.id)));
      return [...response.photos, ...previous.filter(photo => !seen.has(String(photo.id)))];
    });
    setCursor(old => old === null ? response.nextCursor : old);
    setError('');
  }, [api, wallToken]);

  useEffect(() => {
    if (!wallToken) {
      setLoading(false);
      setError('Invalid photo wall link. Scan the QR code on the display again.');
      return undefined;
    }
    let subscribed = true;
    Promise.all([api.getEvent(wallToken), api.getFeed(wallToken, null, 30)])
      .then(([detail, feed]) => {
        if (!subscribed) return;
        setEvent(detail.event);
        moderationRef.current = feed.event.moderationRevision;
        setPhotos(feed.photos);
        setCursor(feed.nextCursor);
      }).catch(err => { if (subscribed) setError(readableQrWallError(err, 'Photo wall is unavailable')); })
      .finally(() => { if (subscribed) setLoading(false); });
    const ticker = setInterval(() => refresh().catch(() => {}), 8000);
    const stream = new EventSource(api.streamUrl(wallToken));
    stream.addEventListener('change', () => refresh().catch(() => {}));
    return () => { subscribed = false; clearInterval(ticker); stream.close(); };
  }, [api, wallToken, refresh]);

  const clearAlerts = () => { setError(''); setMessage(''); };
  const onUpload = async eventData => {
    eventData.preventDefault();
    if (busy) return;
    clearAlerts();
    if (!wallToken) return setError('The upload link is invalid. Scan the QR code again.');
    if (!name.trim()) return setError('Please enter your name.');
    if (files.length !== 1) return setError('Choose exactly one photo per submission.');
    const file = files[0];
    if (file.size > MAX_PHOTO_BYTES) return setError('This photo exceeds the 10 MB limit.');
    if (file.size === 0) return setError('This photo is empty. Select another image.');

    setBusy(true);
    setUploadProgress('Submitting photo…');
    try {
      sessionStorage.setItem('qr-wall-guest-name', name.trim());
      const response = await api.upload(wallToken, {
        author: name.trim(), caption, photos: [file],
      });
      if (Number(response?.created) !== 1) {
        throw new Error('The server did not confirm this upload. Check with the moderator before retrying.');
      }
      setFiles([]);
      setCaption('');
      setMessage('Your photo was submitted for moderator approval. It will appear publicly once approved.');
      setTab('feed');
      try { await refresh(); } catch { /* feed will retry automatically */ }
    } catch (err) {
      setError(readableQrWallError(err, 'Photo upload failed. Your selection is still available for retry.'));
    } finally {
      setBusy(false);
      setUploadProgress('');
    }

  };
  const onReact = async photo => {
    const id = String(photo.id);
    if (closed || reactBusyIds.has(id)) return null;
    setReactBusyIds(previous => new Set(previous).add(id));
    try {
      // Explicit add/remove endpoints make retries idempotent and prevent
      // rapid taps from registering duplicate hearts.
      const response = photo.reacted
        ? await api.unreact(wallToken, id)
        : await api.react(wallToken, id);
      setPhotos(previous => previous.map(item => String(item.id) === id
        ? { ...item, reacted: Boolean(response.reacted), reactionCount: Number(response.reactionCount || 0) }
        : item));
      return response; // Only newly added reactions animate.
    } catch (err) {
      setError(readableQrWallError(err, 'Could not update reaction. Please try again.'));
      return null;
    } finally {
      setReactBusyIds(previous => {
        const updated = new Set(previous);
        updated.delete(id);
        return updated;
      });
    }
  };
  const olderPhotos = async () => {
    if (!cursor) return;
    setBusy(true);
    try {
      const response = await api.getFeed(wallToken, cursor, 30);
      const existing = new Set(photos.map(photo => String(photo.id)));
      setPhotos(previous => [...previous, ...response.photos.filter(photo => !existing.has(String(photo.id)))]);
      setCursor(response.nextCursor);
    } catch (err) { setError(readableQrWallError(err)); }
    finally { setBusy(false); }
  };
  const closed = event?.status !== 'active';

  return (
    <main className="qrw qrw-mobile">
      <header className="qrw-mobile-head">
        <span className="qrw-mobile-brand">
          <img className="qrw-mobile-logo" src="/SiBSLogoWhite.png"
            alt="SiBS — Human Expertise. Technology Forward." />
        </span>
        <span className="qrw-mobile-live"><span className="qrw-status-light" /> LIVE WALL</span>
      </header>
      <div className="qrw-mobile-main">
        <div className="qrw-mobile-hero"><span className="qrw-mobile-overline">CAPTURE · SHARE · CELEBRATE</span>
          <h1>{event?.title || (loading ? 'Loading moments…' : 'Photo wall')}</h1>
          <p>Every photo has a story. Add yours to the moment.</p></div>
        {error ? <div className="qrw-alert qrw-alert-error" role="alert">{error}</div> : null}
        {message ? <div className="qrw-alert qrw-alert-success"><CheckCircle2 size={17} /> {message}</div> : null}
        {!loading && !event ? <div className="qrw-alert qrw-alert-error">This QR link is invalid or unavailable.</div> : null}
        {event ? <>
          {closed ? <div className="qrw-alert">This event has ended. You can still browse the photos.</div> : null}
          <div className="qrw-mobile-tabs" role="tablist" aria-label="Photo wall">
            <button type="button" className={tab === 'feed' ? 'active' : ''} onClick={() => setTab('feed')}>
              <Camera size={17} /> Photo feed</button>
            {!closed ? <button type="button" className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>
              <ImagePlus size={17} /> Upload photos</button> : null}
          </div>
          {tab === 'upload' && !closed ? (
            <form className="qrw-upload-form" onSubmit={onUpload}>
              <div className="qrw-form-intro"><UploadCloud size={24} /><h2>Share your moment</h2><p>Upload one photo per submission (maximum 10 MB). You can submit again anytime.</p></div>
              <label className="qrw-field-label" htmlFor="qrw-name">Your name</label>
              <input id="qrw-name" className="qrw-field" autoComplete="name" value={name} maxLength={60} required disabled={busy}
                placeholder="What should we call you?" onChange={e => setName(e.target.value)} />
              <label className="qrw-upload-picker" htmlFor="qrw-files"><ImagePlus size={33} /><strong>Tap to choose one photo</strong>
                <small>JPG · PNG · WEBP · AVIF · HEIC*</small></label>
              <input id="qrw-files" className="qrw-visually-hidden" type="file" accept="image/*,.heic,.heif" disabled={busy}
                onChange={e => {
                  const selected = Array.from(e.target.files || []);
                  if (selected.length > 1) {
                    setError('Choose only one photo per submission.');
                  } else if (selected[0]?.size > MAX_PHOTO_BYTES) {
                    setError(`"${selected[0].name}" exceeds the 10 MB limit.`);
                  } else if (selected[0]?.size === 0) {
                    setError('The selected photo is empty.');
                  } else {
                    setFiles(selected);
                    setError('');
                  }
                  e.target.value = '';
                }} />
              {files.length ? <p className="qrw-small-print">1 photo selected · maximum 10 MB</p> : null}
              {previews.length ? <div className="qrw-previews">{previews.map(item => (
                <img key={item.url} src={item.url} alt={`Selected ${item.file.name}`} />
              ))}</div> : null}
              <label className="qrw-field-label" htmlFor="qrw-caption">Caption <small>(optional)</small></label>
              <textarea id="qrw-caption" className="qrw-field" rows={3} maxLength={240} value={caption} disabled={busy}
                placeholder="Tell us about this moment…" onChange={e => setCaption(e.target.value)} />
              <button className="qrw-primary" disabled={busy || !files.length} type="submit"><Send size={17} /> {busy ? (uploadProgress || 'Sharing…') : 'Submit photo for approval'}</button>
              <p className="qrw-small-print">*HEIC works when the server supports HEIF decoding. Approved photos are visible to event guests.</p>
            </form>
          ) : (
            <div className="qrw-mobile-feed">
              {loading ? <p>Loading moments…</p> : null}
              {!photos.length && !loading ? <div className="qrw-mobile-empty"><Camera size={35} /><p>No photos yet. Be the first!</p></div> : null}
              {photos.map(photo => <div key={photo.id}>
                <PhotoPost photo={photo} imageUrl={api.imageUrl(wallToken, photo.id)} layout="mobile"
                  onReact={!closed ? onReact : undefined}
                  reacting={reactBusyIds.has(String(photo.id))} />
              </div>)}
              {cursor ? <button className="qrw-load-button" type="button" onClick={olderPhotos} disabled={busy}>View older photos</button> : null}
            </div>
          )}
        </> : null}
      </div>
    </main>
  );
}
