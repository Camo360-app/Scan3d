import ARKit
import CoreImage
import ExpoModulesCore
import ImageIO
import SceneKit

/// Vue de capture : caméra ARKit + nuage de points en temps réel + enregistrement des images clés.
///
/// Fonctionne sans LiDAR : ARKit suit la position du téléphone avec la caméra et les capteurs de mouvement
/// (« world tracking »), et les points viennent des « feature points » détectés dans l'image.
class Scan3dArView: ExpoView, ARSessionDelegate {
  // Événements envoyés à JavaScript.
  let onStatus = EventDispatcher()
  let onCaptureFinished = EventDispatcher()
  let onCaptureError = EventDispatcher()

  // Réglages de la capture.
  private let keyframeMinDistance: Float = 0.07                  // 7 cm de déplacement…
  private let keyframeMinAngle: Float = 10 * .pi / 180           // … ou 10° de rotation
  private let keyframeMinInterval: TimeInterval = 0.25           // au plus 4 images clés par seconde
  private let maxPendingWrites = 3                               // ne jamais bloquer ARKit si l'écriture prend du retard
  private let maxPoints = 150_000
  private let cloudRefreshInterval: TimeInterval = 0.2
  private let statusInterval: TimeInterval = 0.25

  private let sceneView = ARSCNView(frame: .zero)
  private let cloudNode = SCNNode()
  private let writeQueue = DispatchQueue(label: "scan3d.write", qos: .userInitiated)
  private let ciContext = CIContext(options: [.useSoftwareRenderer: false])

  // État (toujours lu et écrit sur le fil principal).
  private var isRunning = false
  private var isRecording = false
  private var scan: ScanSession?
  private var points: [UInt64: SIMD3<Float>] = [:]
  private var lastKeyframeTransform: simd_float4x4?
  private var lastKeyframeTime: TimeInterval = 0
  private var pendingWrites = 0
  private var lastCloudRefresh: TimeInterval = 0
  private var lastStatus: TimeInterval = 0
  private var cloudDirty = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black

    sceneView.automaticallyUpdatesLighting = false
    sceneView.rendersCameraGrain = false
    sceneView.session.delegate = self
    sceneView.scene.rootNode.addChildNode(cloudNode)
    addSubview(sceneView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    sceneView.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      startSession()
    } else {
      // L'écran de capture est fermé : on termine proprement un scan en cours.
      if isRecording {
        setRecording(false)
      }
      sceneView.session.pause()
      isRunning = false
    }
  }

  // MARK: - Session ARKit

  private func startSession() {
    guard !isRunning else { return }
    guard ARWorldTrackingConfiguration.isSupported else {
      onCaptureError(["message": "Cet iPhone ne supporte pas le suivi ARKit."])
      return
    }
    let config = ARWorldTrackingConfiguration()
    config.worldAlignment = .gravity
    config.isAutoFocusEnabled = true
    config.planeDetection = []
    config.environmentTexturing = .none
    sceneView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    isRunning = true
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    let now = frame.timestamp

    accumulatePoints(from: frame)

    if isRecording, case .normal = frame.camera.trackingState, shouldTakeKeyframe(frame) {
      saveKeyframe(frame)
    }

    if cloudDirty && now - lastCloudRefresh >= cloudRefreshInterval {
      lastCloudRefresh = now
      cloudDirty = false
      refreshCloudGeometry()
    }

    if now - lastStatus >= statusInterval {
      lastStatus = now
      sendStatus(frame.camera.trackingState)
    }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    onCaptureError(["message": error.localizedDescription])
  }

  func sessionWasInterrupted(_ session: ARSession) {
    onStatus(statusPayload(tracking: "interrupted", reason: "interrupted"))
  }

  // MARK: - Enregistrement

  func setRecording(_ recording: Bool) {
    guard recording != isRecording else { return }
    if recording {
      do {
        scan = try ScanSession.create()
      } catch {
        onCaptureError(["message": "Impossible de créer le dossier du scan : \(error.localizedDescription)"])
        return
      }
      // On repart d'un nuage vide pour que le nuage affiché corresponde au scan.
      points.removeAll(keepingCapacity: true)
      cloudDirty = true
      lastKeyframeTransform = nil
      lastKeyframeTime = 0
      isRecording = true
    } else {
      isRecording = false
      finishScan()
    }
  }

  private func shouldTakeKeyframe(_ frame: ARFrame) -> Bool {
    guard pendingWrites < maxPendingWrites else { return false }
    guard frame.timestamp - lastKeyframeTime >= keyframeMinInterval else { return false }
    guard let last = lastKeyframeTransform else { return true }

    let current = frame.camera.transform
    let p0 = SIMD3<Float>(last.columns.3.x, last.columns.3.y, last.columns.3.z)
    let p1 = SIMD3<Float>(current.columns.3.x, current.columns.3.y, current.columns.3.z)
    if simd_distance(p0, p1) >= keyframeMinDistance { return true }

    // La caméra ARKit regarde vers -Z : on compare les deux directions de visée.
    let f0 = -SIMD3<Float>(last.columns.2.x, last.columns.2.y, last.columns.2.z)
    let f1 = -SIMD3<Float>(current.columns.2.x, current.columns.2.y, current.columns.2.z)
    let angle = acos(max(-1, min(1, simd_dot(simd_normalize(f0), simd_normalize(f1)))))
    return angle >= keyframeMinAngle
  }

  private func saveKeyframe(_ frame: ARFrame) {
    guard let scan = scan else { return }

    let index = scan.frames.count + 1
    let fileName = String(format: "frame_%05d.jpg", index)
    let record = KeyframeRecord(
      index: index,
      filePath: "images/\(fileName)",
      timestamp: frame.timestamp,
      transform: frame.camera.transform,
      intrinsics: frame.camera.intrinsics,
      width: Int(frame.camera.imageResolution.width),
      height: Int(frame.camera.imageResolution.height)
    )
    scan.frames.append(record)
    lastKeyframeTransform = frame.camera.transform
    lastKeyframeTime = frame.timestamp
    pendingWrites += 1

    // L'image est gardée telle que le capteur la donne (paysage) : elle correspond aux paramètres de la caméra.
    let image = CIImage(cvPixelBuffer: frame.capturedImage)
    let url = scan.imagesURL.appendingPathComponent(fileName)
    let context = ciContext
    let shouldCheckpoint = index % 10 == 0
    let snapshot = shouldCheckpoint ? scan.frames : []
    let scanURL = scan.url
    writeQueue.async { [weak self] in
      let quality = CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String)
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
      var errorMessage: String?
      if let data = context.jpegRepresentation(of: image, colorSpace: colorSpace, options: [quality: 0.9]) {
        do { try data.write(to: url, options: .atomic) } catch { errorMessage = error.localizedDescription }
      } else {
        errorMessage = "Image \(index) non convertie en JPEG."
      }
      // Sauvegarde régulière des positions : rien n'est perdu si l'app se ferme d'un coup.
      if shouldCheckpoint {
        try? ScanStorage.writeTransforms(frames: snapshot, to: scanURL)
      }
      DispatchQueue.main.async {
        guard let self = self else { return }
        self.pendingWrites -= 1
        if let message = errorMessage {
          self.onCaptureError(["message": message])
        }
      }
    }
  }

  private func finishScan() {
    guard let scan = scan else { return }
    self.scan = nil
    let frames = scan.frames
    let cloud = Array(points.values)
    let scanURL = scan.url
    let startedAt = scan.startedAt

    // La file est en série : ces écritures passent après toutes les images en attente.
    writeQueue.async { [weak self] in
      var errorMessage: String?
      do {
        try ScanStorage.writeTransforms(frames: frames, to: scanURL)
        try ScanStorage.writePly(points: cloud, to: scanURL.appendingPathComponent("points.ply"))
        try ScanStorage.writeInfo(
          to: scanURL, startedAt: startedAt, keyframes: frames.count, points: cloud.count)
      } catch {
        errorMessage = error.localizedDescription
      }
      DispatchQueue.main.async {
        guard let self = self else { return }
        if let message = errorMessage {
          self.onCaptureError(["message": "Scan non enregistré au complet : \(message)"])
        }
        self.onCaptureFinished([
          "path": scanURL.path,
          "name": scanURL.lastPathComponent,
          "keyframes": frames.count,
          "points": cloud.count,
        ])
      }
    }
  }

  // MARK: - Nuage de points

  private func accumulatePoints(from frame: ARFrame) {
    guard let raw = frame.rawFeaturePoints, points.count < maxPoints else { return }
    let ids = raw.identifiers
    let positions = raw.points
    for i in 0..<min(ids.count, positions.count) {
      // Le même identifiant = le même point physique : on garde sa position la plus récente (la plus précise).
      points[ids[i]] = positions[i]
    }
    if !ids.isEmpty { cloudDirty = true }
  }

  private func refreshCloudGeometry() {
    guard !points.isEmpty else {
      cloudNode.geometry = nil
      return
    }
    let vertices = points.values.map { SCNVector3($0.x, $0.y, $0.z) }
    let source = SCNGeometrySource(vertices: vertices)
    let indices = (0..<Int32(vertices.count)).map { $0 }
    let element = SCNGeometryElement(indices: indices, primitiveType: .point)
    element.pointSize = 4
    element.minimumPointScreenSpaceRadius = 2
    element.maximumPointScreenSpaceRadius = 5

    let geometry = SCNGeometry(sources: [source], elements: [element])
    let material = SCNMaterial()
    material.lightingModel = .constant
    material.diffuse.contents = UIColor(red: 0.2, green: 0.9, blue: 1.0, alpha: 1.0)
    geometry.materials = [material]
    cloudNode.geometry = geometry
  }

  // MARK: - État envoyé à l'écran

  private func sendStatus(_ state: ARCamera.TrackingState) {
    switch state {
    case .normal:
      onStatus(statusPayload(tracking: "normal", reason: nil))
    case .notAvailable:
      onStatus(statusPayload(tracking: "notAvailable", reason: nil))
    case .limited(let reason):
      let text: String
      switch reason {
      case .initializing: text = "initializing"
      case .excessiveMotion: text = "excessiveMotion"
      case .insufficientFeatures: text = "insufficientFeatures"
      case .relocalizing: text = "relocalizing"
      @unknown default: text = "unknown"
      }
      onStatus(statusPayload(tracking: "limited", reason: text))
    }
  }

  private func statusPayload(tracking: String, reason: String?) -> [String: Any] {
    return [
      "tracking": tracking,
      "reason": reason ?? "",
      "points": points.count,
      "keyframes": scan?.frames.count ?? 0,
      "recording": isRecording,
    ]
  }
}
