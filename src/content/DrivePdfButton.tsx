/**
 * Google Drive's preview (drive.google.com/file/d/…/view) renders pages as
 * canvas/image tiles, the same dead end as Chrome's native PDF viewer — no
 * text ever reaches the DOM for us to read. So instead of scraping the
 * preview, this fetches the file's actual bytes and hands them to Narrate's
 * own PDF.js reader (see service-worker.ts's OPEN_DRIVE_PDF handoff).
 *
 * The fetch has to happen here, in the content script, rather than in the
 * background: only a request that actually originates from a document on
 * drive.google.com carries that site's session cookies to
 * drive.usercontent.google.com. A background/service-worker fetch is a
 * cross-site request with no such cookies and would fail on anything but a
 * fully public file.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/shared/messaging';

const FILE_ID_PATTERN = /^\/file\/d\/([\w-]+)/;

function driveFileId(): string | null {
  if (location.hostname !== 'drive.google.com') return null;
  return location.pathname.match(FILE_ID_PATTERN)?.[1] ?? null;
}

function looksLikePdf(buffer: ArrayBuffer): boolean {
  const head = new Uint8Array(buffer.slice(0, 5));
  return String.fromCharCode(...head) === '%PDF-';
}

/** Drive titles the tab "{filename} - Google Drive"; strip the suffix. */
function fileNameFromTitle(): string {
  const title = document.title.replace(/\s*-\s*Google Drive\s*$/i, '').trim();
  return title || 'Document.pdf';
}

type Status = 'idle' | 'fetching' | 'error';

export function DrivePdfButton() {
  const [fileId, setFileId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    setFileId(driveFileId());
    // Drive is a single-page app — switching between files in the same tab
    // doesn't reload the document, so URL changes need their own watch.
    const check = () => setFileId(driveFileId());
    window.addEventListener('popstate', check);
    const poll = window.setInterval(check, 1500);
    return () => {
      window.removeEventListener('popstate', check);
      window.clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    setStatus('idle');
  }, [fileId]);

  const open = useCallback(async () => {
    if (!fileId) return;
    setStatus('fetching');
    try {
      const downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
      const response = await fetch(downloadUrl, { credentials: 'include' });
      if (!response.ok) throw new Error(String(response.status));
      const buffer = await response.arrayBuffer();
      // Drive answers restricted / not-actually-a-PDF files with an HTML
      // page (a 200, so status alone can't catch it) — check the bytes.
      if (!looksLikePdf(buffer)) throw new Error('not-a-pdf');
      const opened = await api.openDrivePdf(fileNameFromTitle(), buffer);
      if (!opened) throw new Error('open-failed');
      setStatus('idle');
    } catch {
      setStatus('error');
      window.setTimeout(() => setStatus('idle'), 4000);
    }
  }, [fileId]);

  if (!fileId) return null;

  return (
    <button
      type="button"
      className="n-drive-btn"
      data-status={status}
      disabled={status === 'fetching'}
      onClick={() => void open()}
    >
      {status === 'fetching'
        ? 'Opening in Narrate…'
        : status === 'error'
          ? "Couldn't open this file — retry"
          : '🔊 Narrate this PDF'}
    </button>
  );
}
