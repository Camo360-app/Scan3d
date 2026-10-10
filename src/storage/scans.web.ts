import { zipSync } from 'fflate';

import type { ScanSummary } from '../../modules/scan3d-ar';

export type { ScanSummary };

/** Favori web : les scans restent dans le téléphone (IndexedDB) jusqu'à l'export. */
export const canExport = true;

/** Orientation du téléphone au moment de la photo, en degrés (capteurs du téléphone). */
export type FrameOrientation = {
  /** Rotation autour de la verticale, depuis le début du scan (0 à 360). */
  yaw: number;
  /** Inclinaison avant/arrière (90 = téléphone debout). */
  pitch: number;
  roll: number;
  /** Cap de la boussole, si Safari le donne. */
  compass: number | null;
};

export type FrameMeta = {
  index: number;
  file: string;
  timestamp: number;
  width: number;
  height: number;
  orientation: FrameOrientation | null;
};

type ScanRecord = {
  name: string;
  startedAt: string;
  finishedAt?: string;
  keyframes: number;
  userAgent: string;
};

type FrameRecord = { scan: string; index: number; blob: Blob; meta: FrameMeta };

const DB_NAME = 'scan3d';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('scans', { keyPath: 'name' });
      const frames = db.createObjectStore('frames', { keyPath: ['scan', 'index'] });
      frames.createIndex('scan', 'scan');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Change la fiche d'un scan dans la même transaction (sans attendre, pour que la transaction reste ouverte). */
function updateScan(tx: IDBTransaction, name: string, change: (r: ScanRecord) => ScanRecord): void {
  const scans = tx.objectStore('scans');
  const request = scans.get(name) as IDBRequest<ScanRecord | undefined>;
  request.onsuccess = () => {
    if (request.result) scans.put(change(request.result));
  };
}

function scanName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `scan-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Commence un scan. Demande aussi à Safari de ne pas effacer les photos quand l'espace manque. */
export async function startScan(): Promise<string> {
  navigator.storage?.persist?.().catch(() => undefined);
  const now = new Date();
  const record: ScanRecord = {
    name: scanName(now),
    startedAt: now.toISOString(),
    keyframes: 0,
    userAgent: navigator.userAgent,
  };
  const db = await openDb();
  const tx = db.transaction('scans', 'readwrite');
  tx.objectStore('scans').put(record);
  await done(tx);
  return record.name;
}

export async function addFrame(scan: string, blob: Blob, meta: FrameMeta): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['scans', 'frames'], 'readwrite');
  const frame: FrameRecord = { scan, index: meta.index, blob, meta };
  tx.objectStore('frames').put(frame);
  updateScan(tx, scan, (r) => ({ ...r, keyframes: Math.max(r.keyframes, meta.index) }));
  await done(tx);
}

export async function finishScan(scan: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('scans', 'readwrite');
  updateScan(tx, scan, (r) => ({ ...r, finishedAt: new Date().toISOString() }));
  await done(tx);
}

export async function listScans(): Promise<ScanSummary[]> {
  const db = await openDb();
  const records = await result(db.transaction('scans').objectStore('scans').getAll() as IDBRequest<ScanRecord[]>);
  return records
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((r) => ({ name: r.name, path: r.name, keyframes: r.keyframes, finishedAt: r.finishedAt }));
}

async function framesOf(scan: string): Promise<FrameRecord[]> {
  const db = await openDb();
  const index = db.transaction('frames').objectStore('frames').index('scan');
  const frames = await result(index.getAll(scan) as IDBRequest<FrameRecord[]>);
  return frames.sort((a, b) => a.index - b.index);
}

/**
 * Exporte un scan en un seul fichier .zip : images/frame_00001.jpg … + scan.json.
 * Sur iPhone, la feuille de partage s'ouvre (« Enregistrer dans Fichiers », AirDrop, courriel…).
 */
export async function exportScan(scan: string): Promise<void> {
  const db = await openDb();
  const record = await result(db.transaction('scans').objectStore('scans').get(scan) as IDBRequest<ScanRecord | undefined>);
  const frames = await framesOf(scan);

  const files: Record<string, Uint8Array> = {};
  for (const f of frames) {
    files[f.meta.file] = new Uint8Array(await f.blob.arrayBuffer());
  }
  const info = {
    ...record,
    source: 'Scan3D web',
    note: 'Positions de caméra à calculer par la reconstruction (COLMAP, Nerfstudio…). orientation = capteurs du téléphone, indicatif.',
    frames: frames.map((f) => f.meta),
  };
  files['scan.json'] = new TextEncoder().encode(JSON.stringify(info, null, 2));

  // Niveau 0 : les JPEG sont déjà compressés, on les range seulement (plus rapide sur le téléphone).
  const zip = zipSync(files, { level: 0 });
  const file = new File([zip], `${scan}.zip`, { type: 'application/zip' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: scan });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // l'utilisateur a fermé la feuille de partage
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function deleteScan(scan: string): Promise<void> {
  const frames = await framesOf(scan);
  const db = await openDb();
  const tx = db.transaction(['scans', 'frames'], 'readwrite');
  for (const f of frames) tx.objectStore('frames').delete([scan, f.index]);
  tx.objectStore('scans').delete(scan);
  await done(tx);
}
