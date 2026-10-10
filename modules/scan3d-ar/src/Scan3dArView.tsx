import { requireNativeView } from 'expo';
import * as React from 'react';

import type { Scan3dArViewProps } from './Scan3dAr.types';

// Chargée au premier affichage seulement : sur Android ou le Web, l'app ne plante pas au démarrage.
let NativeView: React.ComponentType<Scan3dArViewProps> | null = null;

/** Caméra ARKit avec le nuage de points. iPhone seulement. */
export default function Scan3dArView(props: Scan3dArViewProps) {
  if (!NativeView) {
    NativeView = requireNativeView<Scan3dArViewProps>('Scan3dAr');
  }
  return <NativeView {...props} />;
}
