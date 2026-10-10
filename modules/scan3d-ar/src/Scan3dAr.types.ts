import type { ViewProps } from 'react-native';

/** État du suivi ARKit. */
export type TrackingState = 'normal' | 'limited' | 'notAvailable' | 'interrupted';

/** Raison d'un suivi limité (vide si le suivi est normal). */
export type TrackingReason =
  | ''
  | 'initializing'
  | 'excessiveMotion'
  | 'insufficientFeatures'
  | 'relocalizing'
  | 'interrupted'
  | 'unknown';

export type CaptureStatus = {
  tracking: TrackingState;
  reason: TrackingReason;
  /** Nombre de points dans le nuage. */
  points: number;
  /** Nombre d'images clés enregistrées dans le scan en cours. */
  keyframes: number;
  recording: boolean;
};

export type CaptureFinished = {
  /** Chemin complet du dossier du scan sur l'iPhone. */
  path: string;
  name: string;
  keyframes: number;
  points: number;
};

export type CaptureError = { message: string };

export type ScanSummary = {
  name: string;
  path: string;
  keyframes: number;
  points?: number;
  finishedAt?: string;
};

export type Scan3dArViewProps = ViewProps & {
  /** Vrai = on enregistre un scan. Passer à faux termine et sauvegarde le scan. */
  recording: boolean;
  onStatus?: (event: { nativeEvent: CaptureStatus }) => void;
  onCaptureFinished?: (event: { nativeEvent: CaptureFinished }) => void;
  onCaptureError?: (event: { nativeEvent: CaptureError }) => void;
};
