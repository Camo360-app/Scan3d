import { requireOptionalNativeModule } from 'expo';

import type { ScanSummary } from './Scan3dAr.types';

type Scan3dArNative = {
  isSupported(): boolean;
  hasLidar(): boolean;
  listScans(): Promise<ScanSummary[]>;
};

// « Optional » : sur Android, sur le Web ou dans Expo Go, le module n'existe pas et on reçoit null.
const native = requireOptionalNativeModule<Scan3dArNative>('Scan3dAr');

/** Le module natif est-il présent (build de développement iPhone) ? */
export const isAvailable = native != null;

/** Vrai si l'iPhone sait faire le suivi ARKit. */
export function isSupported(): boolean {
  return native?.isSupported() ?? false;
}

/** Vrai si l'iPhone a un LiDAR (pas obligatoire). */
export function hasLidar(): boolean {
  return native?.hasLidar() ?? false;
}

/** Les scans enregistrés sur l'iPhone, le plus récent en premier. */
export async function listScans(): Promise<ScanSummary[]> {
  return native ? native.listScans() : [];
}
