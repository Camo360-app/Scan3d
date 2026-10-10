import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isAvailable, Scan3dArView, type CaptureStatus } from '../../modules/scan3d-ar';

/** Conseil affiché selon l'état du suivi ARKit. */
function hint(status: CaptureStatus | null): string {
  if (!status) return 'Démarrage de la caméra…';
  if (status.tracking === 'normal') {
    return status.recording ? 'Bien. Tourne lentement autour de l’objet.' : 'Prêt. Vise l’objet puis appuie sur « Démarrer ».';
  }
  switch (status.reason) {
    case 'initializing':
      return 'Bouge doucement le téléphone pour démarrer.';
    case 'excessiveMotion':
      return 'Trop vite. Ralentis.';
    case 'insufficientFeatures':
      return 'Pas assez de détails. Ajoute de la lumière ou vise une surface texturée.';
    case 'relocalizing':
      return 'Repositionnement… Reviens vers l’endroit précédent.';
    case 'interrupted':
      return 'Caméra interrompue.';
    default:
      return 'Suivi limité.';
  }
}

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<CaptureStatus | null>(null);

  if (!isAvailable) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>La capture marche seulement dans le build de développement sur iPhone.</Text>
      </View>
    );
  }

  const good = status?.tracking === 'normal';

  return (
    <View style={styles.container}>
      <Scan3dArView
        style={StyleSheet.absoluteFill}
        recording={recording}
        onStatus={(e) => setStatus(e.nativeEvent)}
        onCaptureFinished={(e) => {
          const { keyframes, points, name } = e.nativeEvent;
          Alert.alert('Scan enregistré', `${name}\n${keyframes} images clés · ${points} points`, [
            { text: 'OK', onPress: () => router.back() },
          ]);
        }}
        onCaptureError={(e) => Alert.alert('Problème', e.nativeEvent.message)}
      />

      <View style={[styles.topBar, { top: 12 }]}>
        <View style={[styles.dot, { backgroundColor: good ? '#22c55e' : '#f59e0b' }]} />
        <Text style={styles.hint}>{hint(status)}</Text>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.counter}>
          {status?.keyframes ?? 0} images clés · {status?.points ?? 0} points
        </Text>
        <Pressable
          style={({ pressed }) => [styles.button, recording && styles.buttonStop, pressed && { opacity: 0.8 }]}
          onPress={() => setRecording((r) => !r)}
        >
          <Text style={styles.buttonText}>{recording ? 'Terminer' : 'Démarrer'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(11,18,32,0.75)',
    borderRadius: 12,
    padding: 12,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  hint: { color: '#ffffff', fontSize: 16, flexShrink: 1 },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    gap: 12,
    paddingTop: 16,
    backgroundColor: 'rgba(11,18,32,0.75)',
  },
  counter: { color: '#c7d2e3', fontSize: 15 },
  button: { backgroundColor: '#22c3ee', borderRadius: 40, paddingVertical: 18, paddingHorizontal: 48 },
  buttonStop: { backgroundColor: '#ef4444' },
  buttonText: { color: '#0b1220', fontSize: 20, fontWeight: '700' },
});
