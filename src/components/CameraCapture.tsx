'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CARD_ASPECT } from '@/lib/card-geometry';

/**
 * Rear-camera capture with a card-shaped alignment guide.
 *
 * Capture quality is the single biggest lever on downstream accuracy: the print
 * and text signals in the authenticity engine need roughly 1300+ pixels across
 * the card's short edge, so we request the highest resolution the device will
 * give us and tell the user when the result is too soft to analyse.
 *
 * `getUserMedia` needs a secure context (https, or localhost). When it is
 * unavailable — http on a LAN address, an iOS in-app browser, a denied
 * permission — we fall back to the file input, which opens the native camera
 * app and reliably produces a full-resolution photo.
 */

export interface CaptureResult {
  /** JPEG data URL of the full-resolution frame. */
  dataUrl: string;
  width: number;
  height: number;
  /** The guide rectangle in image pixel coordinates, if the guide was shown. */
  guide: { x: number; y: number; width: number; height: number } | null;
}

interface Props {
  onCapture: (result: CaptureResult) => void;
  busy?: boolean;
  /** Label for the shutter button, e.g. "Scan card" or "Add to pile". */
  shutterLabel?: string;
}

type CameraState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'live' }
  | { status: 'unavailable'; reason: string };

export function CameraCapture({ onCapture, busy = false, shutterLabel = 'Scan card' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>({ status: 'idle' });
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState({
        status: 'unavailable',
        reason:
          'Live camera needs a secure connection (https or localhost). Use the photo button below instead.',
      });
      return;
    }

    setState({ status: 'starting' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          // Ask high; the browser clamps to the best the hardware supports.
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // iOS Safari refuses to play inline without both of these.
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play().catch(() => undefined);
      }

      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      setTorchSupported(Boolean(caps?.torch));
      setState({ status: 'live' });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      const reason =
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it in your browser settings, or use the photo button below.'
          : name === 'NotFoundError'
            ? 'No camera found on this device. Use the photo button below.'
            : 'Could not start the camera. Use the photo button below.';
      setState({ status: 'unavailable', reason });
    }
  }, []);

  useEffect(() => stop, [stop]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      // `torch` is a well-supported Chrome/Android extension that the standard
      // MediaTrackConstraintSet type does not describe.
      await track.applyConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }, [torchOn]);

  const shoot = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    // The guide is centred and sized to the same fraction of the preview as the
    // CSS overlay, so downstream code can crop to it without re-deriving layout.
    const guideH = h * 0.78;
    const guideW = guideH * CARD_ASPECT;
    const guide = {
      x: Math.round((w - guideW) / 2),
      y: Math.round((h - guideH) / 2),
      width: Math.round(guideW),
      height: Math.round(guideH),
    };

    onCapture({ dataUrl: canvas.toDataURL('image/jpeg', 0.92), width: w, height: h, guide });
  }, [onCapture]);

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        const img = new Image();
        img.onload = () =>
          onCapture({ dataUrl, width: img.naturalWidth, height: img.naturalHeight, guide: null });
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [onCapture],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-2xl border border-ink-800 bg-ink-900">
        <div className="relative aspect-3/4 w-full">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`h-full w-full object-cover ${state.status === 'live' ? '' : 'invisible'}`}
          />

          {state.status === 'live' && <AlignmentGuide />}

          {state.status !== 'live' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              {state.status === 'starting' ? (
                <p className="text-sm text-ink-300">Starting camera…</p>
              ) : (
                <>
                  <div className="rounded-full bg-ink-800 p-4">
                    <svg className="h-7 w-7 text-ink-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.3-2h7l1.3 2h1.7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9Z" strokeLinejoin="round" />
                      <circle cx="12" cy="13" r="3.6" />
                    </svg>
                  </div>
                  {state.status === 'unavailable' ? (
                    <p className="max-w-xs text-sm text-ink-300">{state.reason}</p>
                  ) : (
                    <p className="max-w-xs text-sm text-ink-300">
                      Point your camera at a single card, filling the frame.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={start}
                    className="rounded-lg bg-bolt-500 px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-bolt-400"
                  >
                    {state.status === 'unavailable' ? 'Try camera again' : 'Start camera'}
                  </button>
                </>
              )}
            </div>
          )}

          {torchSupported && state.status === 'live' && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-pressed={torchOn}
              aria-label="Toggle flashlight"
              className={`absolute right-3 top-3 rounded-full p-2.5 backdrop-blur ${
                torchOn ? 'bg-bolt-500 text-ink-950' : 'bg-ink-950/60 text-ink-200'
              }`}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M13 2 5 13h6l-1 9 8-11h-6l1-9Z" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={shoot}
          disabled={state.status !== 'live' || busy}
          className="flex-1 rounded-xl bg-bolt-500 px-4 py-3.5 text-base font-semibold text-ink-950 transition-colors hover:bg-bolt-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
        >
          {busy ? 'Analysing…' : shutterLabel}
        </button>

        <label
          className={`shrink-0 cursor-pointer rounded-xl border border-ink-700 px-4 py-3.5 text-sm font-medium text-ink-200 hover:bg-ink-850 ${
            busy ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          Photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFile}
            className="sr-only"
            disabled={busy}
          />
        </label>
      </div>

      <p className="text-center text-xs text-ink-400">
        Fill the frame, avoid glare, and keep the card flat and in focus. Blurry or angled photos
        make the authenticity checks abstain rather than guess.
      </p>
    </div>
  );
}

/** Card-shaped cutout with corner ticks, at the true 63×88mm aspect ratio. */
function AlignmentGuide() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className="relative h-[78%] rounded-xl outline outline-2 outline-bolt-400/80"
        style={{ aspectRatio: String(CARD_ASPECT) }}
      >
        {(['-top-px -left-px border-t-4 border-l-4 rounded-tl-xl',
           '-top-px -right-px border-t-4 border-r-4 rounded-tr-xl',
           '-bottom-px -left-px border-b-4 border-l-4 rounded-bl-xl',
           '-bottom-px -right-px border-b-4 border-r-4 rounded-br-xl'] as const).map((cls) => (
          <span key={cls} className={`absolute h-7 w-7 border-bolt-400 ${cls}`} />
        ))}
      </div>
    </div>
  );
}
