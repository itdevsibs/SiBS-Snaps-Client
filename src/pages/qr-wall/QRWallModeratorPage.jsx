import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, ShieldCheck, LogOut, RefreshCcw, Camera, Loader2, Eye, EyeOff, Download, AlertTriangle, X, Trash2 } from 'lucide-react';
import { readableQrWallError } from '../../lib/axios/qrWallApi';
import './moderator.css';

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
}

export default function QRWallModeratorPage({ api }) {
  const [moderator, setModerator] = useState(null);
  const [sibsId, setSibsId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(true);
  const [loggingIn, setLoggingIn] = useState(false);
  const [tab, setTab] = useState('pending');
  const [photos, setPhotos] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [cursor, setCursor] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rejectPhoto, setRejectPhoto] = useState(null);
  const [rejectError, setRejectError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [cleanupPending, setCleanupPending] = useState(false);
  const rejectDialogRef = useRef(null);
  const rejectCancelRef = useRef(null);
  const deleteDialogRef = useRef(null);
  const deleteCancelRef = useRef(null);
  const deletingRef = useRef(false);
  deletingRef.current = deleting;
  const busyIdRef = useRef(null);
  busyIdRef.current = busyId;

  // Accessible in-app confirmation: lock scrolling, trap keyboard focus,
  // support Escape while idle, and restore focus on close.
  useEffect(() => {
    if (!rejectPhoto) return undefined;
    const previousFocus = document.activeElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    rejectCancelRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyIdRef.current) setRejectPhoto(null);
      }
      if (event.key !== 'Tab') return;
      const available = Array.from(rejectDialogRef.current?.querySelectorAll('button:not(:disabled)') || []);
      if (!available.length) { event.preventDefault(); return; }
      const first = available[0];
      const last = available[available.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = originalOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [rejectPhoto?.id]);

  useEffect(() => {
    if (!deleteTarget) return undefined;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    deleteCancelRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape' && !deletingRef.current) {
        event.preventDefault(); setDeleteTarget(null);
      }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(deleteDialogRef.current?.querySelectorAll('button:not(:disabled),input:not(:disabled)') || []);
      if (!nodes.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault(); nodes.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault(); nodes[0].focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [deleteTarget?.id, deleteTarget?.status]);

  const openDelete = (photo = null) => {
    if (busyId || deleting) return;
    const status = photo?.status || tab;
    if (status !== 'approved' && status !== 'rejected') return;
    setError(''); setNotice(''); setDeleteError(''); setDeletePhrase('');
    setDeleteTarget(photo ? { kind: 'single', photo, id: String(photo.id), status }
      : { kind: 'all', status, count: Number(counts[status] || 0) });
  };
  const closeDelete = () => { if (!deletingRef.current) setDeleteTarget(null); };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting || (deleteTarget.kind === 'all' && deletePhrase !== 'DELETE ALL')) return;
    const target = deleteTarget;
    setDeleting(true); setDeleteError(''); setError(''); setNotice('');
    let totalDeleted = 0;
    let cleanupFailures = 0;
    try {
      if (target.kind === 'single') {
        const result = await api.moderatorDelete(target.id);
        totalDeleted = Number(result.deletedCount || 0);
        cleanupFailures = Number(result.cleanupFailed || 0);
      } else {
        let upToId = null;
        // Bounded server batches; no limitation on total deletions.
        // Stops if the server returns no progress to avoid an endless loop.
        for (;;) {
          const result = await api.moderatorDeleteBatch(target.status, upToId);
          if (upToId == null) upToId = result.upToId;
          totalDeleted += Number(result.deletedCount || 0);
          cleanupFailures += Number(result.cleanupFailed || 0);
          if (!Number(result.remainingCount || 0)) break;
          if (!Number(result.deletedCount || 0)) throw new Error('Deletion made no progress. Refresh the page and retry.');
        }
      }
      setDeleteTarget(null);
      setCleanupPending(cleanupFailures > 0);
      setNotice(`${totalDeleted} ${target.status} photo${totalDeleted === 1 ? '' : 's'} permanently deleted. ${cleanupFailures > 0
        ? `${cleanupFailures} stored file${cleanupFailures === 1 ? '' : 's'} could not be removed yet. Use Retry file cleanup.`
        : 'Stored files and recovery copies removed.'}`);
      await load(tab);
    } catch (err) {
      const message = readableQrWallError(err, 'Could not delete photo.');
      setDeleteError(`${message}${totalDeleted ? ` ${totalDeleted} photo(s) already deleted; refresh to see the current result.` : ''}`);
      if (totalDeleted) await load(tab).catch(() => {});
    } finally { setDeleting(false); }
  };

  const retryCleanup = async () => {
    if (deleting) return;
    setDeleting(true); setError('');
    try {
      const result = await api.moderatorRetryDeletionCleanup();
      setCleanupPending(result.remaining > 0);
      setNotice(result.remaining ? `${result.remaining} stored file(s) still need cleanup. Try again after restoring SMB access.`
        : 'Stored-file cleanup is complete.');
    } catch (err) { setError(readableQrWallError(err)); }
    finally { setDeleting(false); }
  };

  const openRejectModal = photo => {
    if (busyId) return;
    setError('');
    setNotice('');
    setRejectError('');
    setRejectPhoto(photo);
  };
  const closeRejectModal = () => {
    if (!busyIdRef.current) setRejectPhoto(null);
  };

  const load = useCallback(async (status = tab, before = null) => {
    const response = await api.moderatorPhotos(status, before);
    setCounts(response.counts || { pending: 0, approved: 0, rejected: 0 });
    setPhotos(current => before ? [...current, ...(response.photos || [])] : response.photos || []);
    setCursor(response.nextCursor);
  }, [api, tab]);

  useEffect(() => {
    let active = true;
    api.moderatorMe().then(response => {
      if (active) setModerator(response.moderator);
    }).catch(() => { if (active) setModerator(null); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!moderator) return undefined;
    let active = true;
    setLoadingPhotos(true);
    load(tab).catch(err => { if (active) setError(readableQrWallError(err)); })
      .finally(() => { if (active) setLoadingPhotos(false); });
    // Poll only pending tab so newly submitted photos arrive without refresh.
    if (tab !== 'pending') return () => { active = false; };
    const timer = window.setInterval(() => {
      load('pending').catch(err => { if (active) setError(readableQrWallError(err)); });
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [moderator, tab, load]);

  const login = async event => {
    event.preventDefault();
    setLoggingIn(true); setError('');
    try {
      const response = await api.moderatorLogin(sibsId.trim(), password);
      setModerator(response.moderator);
      setPassword('');
      setNotice('Welcome to SiBS-Snaps moderation.');
    } catch (err) { setError(readableQrWallError(err, 'Login failed')); }
    finally { setLoggingIn(false); }
  };
  const logout = async () => {
    try { await api.moderatorLogout(); }
    catch (err) { setError(readableQrWallError(err)); }
    finally { setModerator(null); setRejectPhoto(null); setDeleteTarget(null); setPhotos([]); setPassword(''); setCounts({ pending: 0, approved: 0, rejected: 0 }); }
  };
  const decide = async (photo, decision) => {
    if (busyId) return;
    setBusyId(String(photo.id)); setError(''); setNotice('');
    try {
      await api.moderatorDecision(photo.id, decision);
      if (decision === 'rejected') setRejectPhoto(null);
      setNotice(`Photo #${photo.id} ${decision === 'approved' ? 'approved and published' : 'rejected'} successfully.`);
      await load(tab);
    } catch (err) {
      const message = readableQrWallError(err);
      if (decision === 'rejected') setRejectError(message);
      else setError(message);
    } finally { setBusyId(null); }
  };
  const downloadPhoto = async photo => {
    if (downloadingId !== null) return;
    setDownloadingId(String(photo.id));
    setError('');
    try {
      const blob = await api.moderatorDownload(photo.id);
      const url = URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `SiBS-Snaps-${photo.id}.jpg`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError('Unable to download this photo. Confirm it is intact and your moderator session is active.');
    } finally {
      setDownloadingId(null);
    }
  };
  return (
    <main className="snap-mod">
      <div className="snap-mod-wrap">
        <header className="snap-mod-head">
          <div className="snap-mod-mark"><Camera size={29} /><span>SiBS<span className="snap-mod-blue">-Snaps</span></span></div>
          <div className="snap-mod-heading"><ShieldCheck size={24} /><span>Moderator Center</span></div>
          {moderator && <button type="button" className="snap-mod-out" onClick={logout}><LogOut size={17}/> Logout</button>}
        </header>
        {checking ? <div className="snap-mod-empty"><Loader2 className="snap-mod-spin" /> Checking moderator session…</div> : !moderator ? (
          <section className="snap-mod-login">
            <div className="snap-mod-login-brand"><img src="/SiBSLogoNavy.png" alt="SiBS" /><span>Moderator Center</span></div>
            <div className="snap-mod-shield"><ShieldCheck size={35} /></div>
            <h1>Moderator Login</h1>
            <p>Review guest photos before they appear on the anniversary screen.</p>
            {error && <div className="snap-mod-alert" role="alert">{error}</div>}
            <form onSubmit={login}>
              <label>SiBS ID<input autoComplete="username" value={sibsId} onChange={e => setSibsId(e.target.value)} maxLength={60} placeholder="Enter your SiBS ID" required /></label>
              <label>Password<span className="snap-mod-password-field"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required /><button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
              <button className="snap-mod-primary" type="submit" disabled={loggingIn}>{loggingIn ? 'Signing in…' : 'Sign in securely'}</button>
            </form>
          </section>
        ) : (
          <>
            <div className="snap-mod-intro"><div><h1>Photo approvals</h1><p>Welcome, {moderator.sibsId}. Review submissions before publishing them live.</p></div>
              <button type="button" className="snap-mod-refresh" disabled={loadingPhotos} onClick={() => load(tab).catch(err => setError(readableQrWallError(err)))}><RefreshCcw size={17}/> Refresh</button></div>
            {error && <div className="snap-mod-alert" role="alert">{error}</div>}
            {notice && <div className="snap-mod-success" role="status">{notice}</div>}
            <div className="snap-mod-tabs" role="tablist" aria-label="Review status">
              {['pending','approved','rejected'].map(status => <button key={status} type="button" role="tab"
                aria-selected={tab === status} className={tab === status ? 'active' : ''} onClick={() => { setTab(status); setRejectPhoto(null); setDeleteTarget(null); setError(''); setNotice(''); }}>
                {status[0].toUpperCase() + status.slice(1)} <span>{counts[status] || 0}</span>
              </button>)}
            </div>
            {(tab === 'approved' || tab === 'rejected') && Number(counts[tab] || 0) > 0 &&
              <div className="snap-mod-bulk-actions">
                <span>Delete only the {tab} photos. This cannot be undone.</span>
                <button type="button" className="snap-mod-delete-all" disabled={deleting || Boolean(busyId)} onClick={() => openDelete()}>
                  <Trash2 size={16} /> Delete All {tab === 'approved' ? 'Approved' : 'Rejected'} ({counts[tab]})
                </button>
              </div>}
            {cleanupPending && <button type="button" className="snap-mod-cleanup-retry" disabled={deleting} onClick={retryCleanup}>
              <RefreshCcw size={15} /> Retry file cleanup
            </button>}
            {loadingPhotos && !photos.length ? <div className="snap-mod-empty">Loading submissions…</div> : !photos.length ?
              <div className="snap-mod-empty"><CheckCircle2 size={38} /> No {tab} photos.</div> :
              <div className="snap-mod-grid">{photos.map(photo => <article key={photo.id} className="snap-mod-card">
                <div className="snap-mod-image"><img loading="lazy" src={api.moderatorPhotoUrl(photo.id)} alt={photo.caption || 'Submitted photo'} /></div>
                <div className="snap-mod-info">
                  <span className="snap-mod-event">{photo.eventTitle}</span>
                  <h2>{photo.uploadedBy}</h2>
                  <time dateTime={photo.createdAt || undefined}>{formatWhen(photo.createdAt)}</time>
                  <div className="snap-mod-caption-box">
                    <span className="snap-mod-caption-label">Caption</span>
                    <p className="snap-mod-caption-text">{photo.caption?.trim() || 'No caption provided'}</p>
                  </div>
                  {photo.reviewedBy && <small className="snap-mod-reviewed">Reviewed by {photo.reviewedBy} · {formatWhen(photo.reviewedAt)}</small>}
                </div>
                {tab === 'pending' && <div className="snap-mod-actions">
                  <button type="button" className="snap-mod-approve" disabled={Boolean(busyId)} onClick={() => decide(photo, 'approved')}><CheckCircle2 size={17}/> Approve</button>
                  <button type="button" className="snap-mod-reject" disabled={Boolean(busyId)} onClick={() => openRejectModal(photo)}><XCircle size={17}/> Reject</button>
                </div>}
                <div className="snap-mod-download-row">
                  <button type="button" onClick={() => downloadPhoto(photo)} disabled={downloadingId !== null}>
                    <Download size={17} /> {downloadingId === String(photo.id) ? 'Preparing JPG…' : 'Download JPG'}
                  </button>
                </div>
                {(tab === 'approved' || tab === 'rejected') && <div className="snap-mod-delete-row">
                  <button type="button" onClick={() => openDelete(photo)} disabled={deleting || Boolean(busyId)}>
                    <Trash2 size={16} /> Delete photo
                  </button>
                </div>}
              </article>)}</div>}
            {cursor && <button className="snap-mod-more" type="button" onClick={() => load(tab, cursor).catch(err => setError(readableQrWallError(err)))}>Load older photos</button>}
          </>
        )}
      </div>
      {rejectPhoto && moderator && (
        <div className="snap-mod-modal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) closeRejectModal();
        }}>
          <section ref={rejectDialogRef} className="snap-mod-reject-dialog" role="dialog" aria-modal="true"
            aria-labelledby="snap-reject-title" aria-describedby="snap-reject-description">
            <div className="snap-mod-reject-top">
              <span className="snap-mod-reject-icon"><AlertTriangle size={23} /></span>
              <button type="button" className="snap-mod-reject-close" aria-label="Close reject confirmation"
                onClick={closeRejectModal} disabled={Boolean(busyId)}><X size={19} /></button>
            </div>
            <h2 id="snap-reject-title">Reject this photo?</h2>
            <p id="snap-reject-description" className="snap-mod-reject-description">
              This submission will remain private and will not appear in the public photo feed or live slideshow.
            </p>
            <div className="snap-mod-reject-preview">
              <img src={api.moderatorPhotoUrl(rejectPhoto.id)} alt={rejectPhoto.caption || 'Photo to reject'} />
              <div className="snap-mod-reject-details">
                <span>PHOTO #{rejectPhoto.id}</span>
                <strong>{rejectPhoto.uploadedBy || 'Guest'}</strong>
                {rejectPhoto.caption && <p>{rejectPhoto.caption}</p>}
                <small>{formatWhen(rejectPhoto.createdAt)}</small>
              </div>
            </div>
            {rejectError && <div className="snap-mod-alert snap-mod-reject-alert" role="alert">{rejectError}</div>}
            <div className="snap-mod-reject-footer">
              <button type="button" className="snap-mod-reject-cancel" ref={rejectCancelRef}
                onClick={closeRejectModal} disabled={Boolean(busyId)}>Cancel</button>
              <button type="button" className="snap-mod-reject-confirm" onClick={() => decide(rejectPhoto, 'rejected')}
                disabled={Boolean(busyId)}>
                {busyId === String(rejectPhoto.id) ? <Loader2 className="snap-mod-spin" size={17} /> : <XCircle size={17} />}
                {busyId === String(rejectPhoto.id) ? 'Rejecting…' : 'Reject photo'}
              </button>
            </div>
          </section>
        </div>
      )}
      {deleteTarget && moderator && (
        <div className="snap-mod-modal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) closeDelete();
        }}>
          <section ref={deleteDialogRef} className="snap-mod-reject-dialog snap-mod-delete-dialog" role="dialog" aria-modal="true"
            aria-labelledby="snap-delete-title" aria-describedby="snap-delete-description">
            <div className="snap-mod-reject-top">
              <span className="snap-mod-reject-icon snap-mod-delete-icon"><Trash2 size={23} /></span>
              <button type="button" className="snap-mod-reject-close" disabled={deleting} aria-label="Close delete confirmation"
                onClick={closeDelete}><X size={19}/></button>
            </div>
            <h2 id="snap-delete-title">{deleteTarget.kind === 'all'
              ? `Delete all ${deleteTarget.status} photos?` : 'Permanently delete this photo?'}</h2>
            <p id="snap-delete-description" className="snap-mod-reject-description">
              This permanently removes {deleteTarget.kind === 'all' ? `all ${deleteTarget.status} photos across events` : 'the selected photo'}
              , associated comments, and stored copies (including the recovery backup). Approved photos disappear from the live slideshow.
              This cannot be undone.
            </p>
            {deleteTarget.kind === 'single' ? <div className="snap-mod-reject-preview">
              <img src={api.moderatorPhotoUrl(deleteTarget.id)} alt={deleteTarget.photo.caption || 'Photo to delete'} />
              <div className="snap-mod-reject-details">
                <span>PHOTO #{deleteTarget.id} · {deleteTarget.status.toUpperCase()}</span>
                <strong>{deleteTarget.photo.uploadedBy || 'Guest'}</strong>
                {deleteTarget.photo.caption && <p>{deleteTarget.photo.caption}</p>}
              </div>
            </div> : <div className="snap-mod-delete-phrase">
              <strong>{deleteTarget.count} {deleteTarget.status} photo(s) currently listed.</strong>
              <label htmlFor="snap-delete-phrase">Type <b>DELETE ALL</b> to confirm:</label>
              <input id="snap-delete-phrase" value={deletePhrase} onChange={event => setDeletePhrase(event.target.value)}
                autoComplete="off" spellCheck={false} placeholder="DELETE ALL" disabled={deleting}/>
            </div>}
            {deleteError && <div className="snap-mod-alert snap-mod-reject-alert" role="alert">{deleteError}</div>}
            <div className="snap-mod-reject-footer">
              <button type="button" className="snap-mod-reject-cancel" ref={deleteCancelRef} disabled={deleting} onClick={closeDelete}>Cancel</button>
              <button type="button" className="snap-mod-reject-confirm" disabled={deleting || (deleteTarget.kind === 'all' && deletePhrase !== 'DELETE ALL')}
                onClick={confirmDelete}>
                {deleting ? <Loader2 className="snap-mod-spin" size={17} /> : <Trash2 size={17}/>}
                {deleting ? 'Deleting…' : deleteTarget.kind === 'all' ? 'Delete All' : 'Delete photo'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
