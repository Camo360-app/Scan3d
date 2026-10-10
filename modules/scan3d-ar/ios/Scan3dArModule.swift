import ARKit
import ExpoModulesCore

/// Module Scan3D : expose la vue de capture ARKit à React Native.
public class Scan3dArModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Scan3dAr")

    /// Vrai si l'iPhone sait faire le suivi ARKit (iPhone 6s et plus récents). Le LiDAR n'est pas nécessaire.
    Function("isSupported") { () -> Bool in
      return ARWorldTrackingConfiguration.isSupported
    }

    /// Vrai si l'iPhone a un LiDAR (information seulement : la capture fonctionne sans).
    Function("hasLidar") { () -> Bool in
      return ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
    }

    /// Liste les scans enregistrés dans Documents/scans (le plus récent en premier).
    AsyncFunction("listScans") { () -> [[String: Any]] in
      return ScanStorage.listScans()
    }

    View(Scan3dArView.self) {
      Events("onStatus", "onCaptureFinished", "onCaptureError")

      /// Quand `recording` passe à vrai, un nouveau scan commence. À faux, il est terminé et enregistré.
      Prop("recording", false) { (view: Scan3dArView, recording: Bool) in
        view.setRecording(recording)
      }
    }
  }
}
