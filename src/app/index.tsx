import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { hasLidar, isAvailable, isSupported } from '../../modules/scan3d-ar';
import { canExport, deleteScan, exportScan, listScans, type ScanSummary } from '../storage/scans';

const isWeb = Platform.OS === 'web';

export default function HomeScreen() {
  const [scans, setScans] = useState<ScanSummary[]>([]);
  // Sur le Web, la capture passe par la caméra de Safari ; sur l'app installée, par ARKit.
  const canScan = isWeb || isSupported();

  const reload = useCallback(() => {
    listScans().then(setScans).catch(() => setScans([]));
  }, []);

  // Recharge la liste à chaque retour sur l'accueil (après un scan).
  useFocusEffect(reload);

  const remove = (name: string) => {
    const go = () => deleteScan(name).then(reload);
    if (isWeb) {
      if (window.confirm(`Supprimer ${name} ?`)) void go();
    } else {
      Alert.alert('Supprimer ?', name, [{ text: 'Annuler' }, { text: 'Supprimer', style: 'destructive', onPress: go }]);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Scan 3D d'objets</Text>
      <Text style={styles.text}>
        {isWeb
          ? 'Tourne lentement autour de l’objet. L’app prend les photos toute seule.'
          : 'Tourne lentement autour de l’objet. L’app garde les images et les positions.'}
      </Text>

      <Pressable
        style={({ pressed }) => [styles.button, !canScan && styles.buttonDisabled, pressed && styles.buttonPressed]}
        disabled={!canScan}
        onPress={() => router.push('/capture')}
      >
        <Text style={styles.buttonText}>Nouveau scan</Text>
      </Pressable>

      {!isWeb && !isAvailable && (
        <Text style={styles.warning}>
          Module de capture absent. Il faut le build de développement sur iPhone (pas Expo Go).
        </Text>
      )}
      {!isWeb && isAvailable && !canScan && <Text style={styles.warning}>Cet iPhone ne supporte pas ARKit.</Text>}
      {!isWeb && isAvailable && canScan && (
        <Text style={styles.small}>{hasLidar() ? 'LiDAR détecté (pas nécessaire).' : 'Sans LiDAR : ça marche quand même.'}</Text>
      )}

      <Text style={styles.section}>Scans enregistrés</Text>
      <FlatList
        data={scans}
        keyExtractor={(item) => item.path}
        ListEmptyComponent={<Text style={styles.small}>Aucun scan pour le moment.</Text>}
        renderItem={({ item }) => (
          <View style={styles.scan}>
            <View style={styles.scanInfo}>
              <Text style={styles.scanName}>{item.name}</Text>
              <Text style={styles.small}>
                {item.keyframes} {isWeb ? 'photos' : 'images'}
                {item.points != null ? ` · ${item.points} points` : ''}
              </Text>
            </View>
            {canExport && (
              <View style={styles.actions}>
                <Pressable style={styles.smallButton} onPress={() => exportScan(item.name)}>
                  <Text style={styles.smallButtonText}>Exporter</Text>
                </Pressable>
                <Pressable style={[styles.smallButton, styles.deleteButton]} onPress={() => remove(item.name)}>
                  <Text style={[styles.smallButtonText, styles.deleteText]}>Supprimer</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12, backgroundColor: '#0b1220' },
  title: { color: '#ffffff', fontSize: 26, fontWeight: '700', marginTop: 8 },
  text: { color: '#c7d2e3', fontSize: 16 },
  button: { backgroundColor: '#22c3ee', borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginTop: 8 },
  buttonPressed: { opacity: 0.8 },
  buttonDisabled: { backgroundColor: '#3b4a63' },
  buttonText: { color: '#0b1220', fontSize: 20, fontWeight: '700' },
  warning: { color: '#fbbf24', fontSize: 15 },
  small: { color: '#8b9bb4', fontSize: 14 },
  section: { color: '#ffffff', fontSize: 18, fontWeight: '600', marginTop: 16 },
  scan: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a3850',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scanInfo: { flex: 1 },
  scanName: { color: '#ffffff', fontSize: 16 },
  actions: { flexDirection: 'row', gap: 8 },
  smallButton: { backgroundColor: '#22c3ee', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  deleteButton: { backgroundColor: '#3b4a63' },
  smallButtonText: { color: '#0b1220', fontWeight: '600' },
  deleteText: { color: '#ffffff' },
});
