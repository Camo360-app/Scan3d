import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import { addFrame, exportScan, finishScan, startScan, type FrameOrientation } from '../storage/scans.web';

/**
 * Capture dans Safari (favori web). Safari ne donne pas accès à ARKit : pas de nuage de points en direct.
 * On prend des photos guidées en tournant autour de l'objet ; les positions de caméra seront calculées
 * plus tard par la reconstruction. Les capteurs du téléphone servent au guide (anneaux de couverture).
 */

const SECTORS = 24; // 15° par case
const RINGS = ['Bas', 'Milieu', 'Haut'] as const;
const MIN_ANGLE_DEG = 8; // nouvelle photo après 8° de changement de direction…
const MIN_INTERVAL_MS = 350; // … au plus ~3 photos par seconde
const FALLBACK_INTERVAL_MS = 1000; // sans capteurs : une photo par seconde
const STEADY_DEG_PER_S = 30; // au-delà, la photo serait floue
const TOO_FAST_DEG_PER_S = 70;

type Direction = { yaw: number; elevation: number; vector: [number, number, number] };

/** Direction de visée de la caméra arrière, calculée depuis alpha, beta, gamma (repère de la Terre). */
function cameraDirection(alpha: number, beta: number, gamma: number): Direction {
  const r = Math.PI / 180;
  const [cA, sA] = [Math.cos(alpha * r), Math.sin(alpha * r)];
  const [cB, sB] = [Math.cos(beta * r), Math.sin(beta * r)];
  const [cG, sG] = [Math.cos(gamma * r), Math.sin(gamma * r)];
  // La caméra arrière regarde vers -Z du téléphone : on prend la 3e colonne de la rotation, inversée.
  const x = -(cG * sA * sB + cA * sG);
  const y = -(sA * sG - cA * cG * sB);
  const z = -(cB * cG);
  const yaw = ((Math.atan2(x, y) / r) + 360) % 360;
  const elevation = Math.asin(Math.max(-1, Math.min(1, z))) / r;
  return { yaw, elevation, vector: [x, y, z] };
}

function angleBetween(a: Direction, b: Direction): number {
  const d = a.vector[0] * b.vector[0] + a.vector[1] * b.vector[1] + a.vector[2] * b.vector[2];
  return Math.acos(Math.max(-1, Math.min(1, d))) * (180 / Math.PI);
}

/** 0 = bas (presque à l'horizontale), 1 = milieu, 2 = haut (on regarde vers le bas). */
function ringOf(elevation: number): number {
  if (elevation > -20) return 0;
  if (elevation > -45) return 1;
  return 2;
}

type Phase = 'camera' | 'ready' | 'recording' | 'saving' | 'done' | 'error';

export default function CaptureWebScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);

  const [phase, setPhase] = useState<Phase>('camera');
  const [error, setError] = useState('');
  const [count, setCount] = useState(0);
  const [coverage, setCoverage] = useState<boolean[][]>(() => RINGS.map(() => Array(SECTORS).fill(false)));
  const [speed, setSpeed] = useState(0);
  const [hasSensors, setHasSensors] = useState(false);
  const [scanName, setScanName] = useState('');

  // État lu à chaque image vidéo (refs : pas de nouveau rendu à 60 images par seconde).
  const live = useRef({
    scan: '',
    recording: false,
    busy: false,
    index: 0,
    lastShot: 0,
    lastDir: null as Direction | null,
    current: null as Direction | null,
    startYaw: null as number | null,
    orientation: null as FrameOrientation | null,
    rate: 0,
    covered: RINGS.map(() => Array<boolean>(SECTORS).fill(false)),
  });

  // 1. La caméra arrière, en plus haute résolution possible.
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.play().catch(() => undefined);
        }
        setPhase('ready');
      })
      .catch((e: Error) => {
        setError(
          e.name === 'NotAllowedError'
            ? 'Caméra refusée. Réglages → Safari → Caméra → Autoriser, puis recharge la page.'
            : `Caméra indisponible (${e.message}).`,
        );
        setPhase('error');
      });
    if (!navigator.mediaDevices) {
      setError('Caméra indisponible : la page doit être ouverte en https.');
      setPhase('error');
    }
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      wakeLockRef.current?.release().catch(() => undefined);
    };
  }, []);

  // 2. Les capteurs du téléphone (orientation et vitesse de rotation).
  const listenSensors = useCallback(() => {
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      const dir = cameraDirection(e.alpha, e.beta, e.gamma);
      const l = live.current;
      l.current = dir;
      if (l.startYaw == null) l.startYaw = dir.yaw;
      const compass = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      l.orientation = {
        yaw: (dir.yaw - l.startYaw + 360) % 360,
        pitch: dir.elevation,
        roll: e.gamma,
        compass: compass ?? null,
      };
      setHasSensors(true);
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const r = e.rotationRate;
      if (!r) return;
      live.current.rate = Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0);
    };
    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('devicemotion', onMotion);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('devicemotion', onMotion);
    };
  }, []);

  useEffect(() => {
    // Hors iPhone (Android, ordinateur), pas besoin de permission : on écoute tout de suite.
    const needsPermission =
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function';
    if (!needsPermission) return listenSensors();
    return undefined;
  }, [listenSensors]);

  // 3. Prise d'une photo : l'image vidéo complète, en JPEG.
  const takePhoto = useCallback(async () => {
    const l = live.current;
    const video = videoRef.current;
    if (!video || l.busy || !video.videoWidth) return;
    l.busy = true;
    try {
      const canvas = (canvasRef.current ??= document.createElement('canvas'));
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob || !l.recording) return;
      l.index += 1;
      const index = l.index;
      await addFrame(l.scan, blob, {
        index,
        file: `images/frame_${String(index).padStart(5, '0')}.jpg`,
        timestamp: Date.now(),
        width: canvas.width,
        height: canvas.height,
        orientation: l.orientation,
      });
      l.lastShot = performance.now();
      l.lastDir = l.current;
      if (l.orientation && l.current) {
        const ring = ringOf(l.current.elevation);
        const sector = Math.floor(l.orientation.yaw / (360 / SECTORS)) % SECTORS;
        l.covered[ring][sector] = true;
        setCoverage(l.covered.map((r) => [...r]));
      }
      setCount(index);
    } catch (e) {
      setError(`Photo non enregistrée : ${(e as Error).message}`);
    } finally {
      l.busy = false;
    }
  }, []);

  // 4. Boucle : décide quand prendre une photo, et met à jour la vitesse affichée.
  useEffect(() => {
    let frame = 0;
    let lastSpeedUpdate = 0;
    const loop = (now: number) => {
      const l = live.current;
      if (now - lastSpeedUpdate > 250) {
        lastSpeedUpdate = now;
        setSpeed(l.rate);
      }
      if (l.recording && !l.busy && now - l.lastShot >= MIN_INTERVAL_MS) {
        if (l.current) {
          const moved = !l.lastDir || angleBetween(l.current, l.lastDir) >= MIN_ANGLE_DEG;
          if (moved && l.rate < STEADY_DEG_PER_S) void takePhoto();
        } else if (now - l.lastShot >= FALLBACK_INTERVAL_MS) {
          void takePhoto();
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [takePhoto]);

  const start = async () => {
    // Sur iPhone, l'accès aux capteurs se demande au moment d'un toucher.
    const request = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
      .requestPermission;
    if (typeof request === 'function') {
      try {
        const answer = await request();
        if (answer === 'granted') listenSensors();
      } catch {
        // Refusé : on continue avec une photo par seconde.
      }
    }
    try {
      wakeLockRef.current = await (
        navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }
      ).wakeLock?.request('screen') ?? null;
    } catch {
      // L'écran pourra s'éteindre : pas grave.
    }
    const l = live.current;
    l.scan = await startScan();
    l.index = 0;
    l.lastShot = 0;
    l.lastDir = null;
    l.startYaw = l.current?.yaw ?? null;
    l.covered = RINGS.map(() => Array<boolean>(SECTORS).fill(false));
    setCoverage(l.covered.map((r) => [...r]));
    setCount(0);
    setScanName(l.scan);
    l.recording = true;
    setPhase('recording');
  };

  const stop = async () => {
    const l = live.current;
    l.recording = false;
    setPhase('saving');
    // On attend la dernière photo en cours d'écriture.
    while (l.busy) await new Promise((r) => setTimeout(r, 50));
    await finishScan(l.scan);
    wakeLockRef.current?.release().catch(() => undefined);
    setPhase('done');
  };

  const ringDone = coverage.map((r) => r.filter(Boolean).length / SECTORS);
  let hint = '';
  if (phase === 'camera') hint = 'Ouverture de la caméra…';
  else if (phase === 'error') hint = error;
  else if (phase === 'ready') hint = 'Vise l’objet, puis appuie sur « Démarrer ».';
  else if (phase === 'saving') hint = 'Enregistrement…';
  else if (phase === 'done') hint = `Scan enregistré : ${count} photos.`;
  else if (speed > TOO_FAST_DEG_PER_S) hint = 'Trop vite. Ralentis.';
  else if (!hasSensors) hint = 'Tourne lentement autour de l’objet (une photo par seconde).';
  else if (ringDone[0] > 0.8 && ringDone[1] < 0.5) hint = 'Bien ! Fais un autre tour, un peu plus haut.';
  else if (ringDone[1] > 0.8 && ringDone[2] < 0.5) hint = 'Encore un tour, en regardant l’objet de haut.';
  else if (ringDone.every((d) => d > 0.8)) hint = 'Tout est couvert. Tu peux terminer.';
  else hint = 'Tourne lentement autour de l’objet.';

  return (
    <div style={styles.root}>
      <video ref={videoRef} style={styles.video} playsInline muted autoPlay />

      <div style={styles.top}>
        <span
          style={{
            ...styles.dot,
            background: phase === 'error' || speed > TOO_FAST_DEG_PER_S ? '#f59e0b' : '#22c55e',
          }}
        />
        <span>{hint}</span>
      </div>

      {phase === 'recording' && hasSensors && <CoverageRings coverage={coverage} />}

      <div style={styles.bottom}>
        {phase === 'recording' || phase === 'saving' ? (
          <>
            <div style={styles.counter}>{count} photos</div>
            <button style={{ ...styles.button, ...styles.stop }} onClick={stop} disabled={phase === 'saving'}>
              Terminer
            </button>
          </>
        ) : phase === 'done' ? (
          <div style={styles.row}>
            <button style={styles.button} onClick={() => exportScan(scanName).catch((e) => setError(String(e)))}>
              Exporter
            </button>
            <button style={{ ...styles.button, ...styles.secondary }} onClick={() => router.back()}>
              Accueil
            </button>
          </div>
        ) : (
          <button style={styles.button} onClick={start} disabled={phase !== 'ready'}>
            Démarrer
          </button>
        )}
      </div>
    </div>
  );
}

/** Trois anneaux de 24 cases : une case se remplit quand une photo est prise dans cette direction. */
function CoverageRings({ coverage }: { coverage: boolean[][] }) {
  const size = 150;
  const c = size / 2;
  const radii = [62, 48, 34];
  return (
    <svg width={size} height={size} style={styles.rings} aria-label="Couverture du scan">
      {coverage.map((ring, ri) =>
        ring.map((filled, si) => {
          const a0 = (si / SECTORS) * 2 * Math.PI - Math.PI / 2;
          const a1 = ((si + 1) / SECTORS) * 2 * Math.PI - Math.PI / 2 - 0.04;
          const r = radii[ri];
          const d = `M ${c + r * Math.cos(a0)} ${c + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${c + r * Math.cos(a1)} ${c + r * Math.sin(a1)}`;
          return (
            <path
              key={`${ri}-${si}`}
              d={d}
              stroke={filled ? '#22c3ee' : 'rgba(255,255,255,0.25)'}
              strokeWidth={9}
              fill="none"
            />
          );
        }),
      )}
    </svg>
  );
}

const panel = 'rgba(11,18,32,0.78)';
const styles: Record<string, CSSProperties> = {
  root: { position: 'absolute', inset: 0, overflow: 'hidden', background: '#000', color: '#fff', fontFamily: '-apple-system, system-ui, sans-serif' },
  video: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' },
  top: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: panel,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
  },
  dot: { width: 12, height: 12, borderRadius: 6, flexShrink: 0 },
  rings: { position: 'absolute', right: 12, top: 76 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: '16px 16px calc(env(safe-area-inset-bottom) + 16px)',
    background: panel,
  },
  row: { display: 'flex', gap: 12 },
  counter: { color: '#c7d2e3', fontSize: 15 },
  button: {
    background: '#22c3ee',
    color: '#0b1220',
    border: 'none',
    borderRadius: 40,
    padding: '18px 40px',
    fontSize: 20,
    fontWeight: 700,
  },
  stop: { background: '#ef4444' },
  secondary: { background: '#3b4a63', color: '#fff' },
};
