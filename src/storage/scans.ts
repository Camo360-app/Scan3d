import { listScans as listNativeScans, type ScanSummary } from '../../modules/scan3d-ar';

export type { ScanSummary };

/** iPhone (app installée) : les scans sont des dossiers dans Documents/scans. */
export const canExport = false;

export function listScans(): Promise<ScanSummary[]> {
  return listNativeScans();
}

export async function exportScan(_name: string): Promise<void> {
  // Sur l'app installée, les fichiers sont déjà visibles dans l'app Fichiers.
}

export async function deleteScan(_name: string): Promise<void> {}
