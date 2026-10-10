import Foundation
import simd

/// Une image clé : le fichier JPEG + la position de la caméra au moment de la prise.
struct KeyframeRecord {
  let index: Int
  let filePath: String
  let timestamp: TimeInterval
  /// Position de la caméra dans le monde (« camera to world »). Convention ARKit = OpenGL :
  /// X à droite, Y en haut, la caméra regarde vers -Z, en mètres.
  let transform: simd_float4x4
  /// Matrice de la caméra (focale et centre optique), en pixels, pour l'image en pleine résolution.
  let intrinsics: simd_float3x3
  let width: Int
  let height: Int
}

/// Un scan en cours : son dossier et la liste de ses images clés.
final class ScanSession {
  let url: URL
  let imagesURL: URL
  let startedAt = Date()
  var frames: [KeyframeRecord] = []

  private init(url: URL) {
    self.url = url
    self.imagesURL = url.appendingPathComponent("images", isDirectory: true)
  }

  static func create() throws -> ScanSession {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyyMMdd-HHmmss"
    let name = "scan-\(formatter.string(from: Date()))"
    let scansURL = try ScanStorage.scansDirectory()
    let session = ScanSession(url: scansURL.appendingPathComponent(name, isDirectory: true))
    try FileManager.default.createDirectory(at: session.imagesURL, withIntermediateDirectories: true)
    return session
  }
}

/// Écriture des fichiers d'un scan.
///
/// Dossier : Documents/scans/scan-AAAAMMJJ-HHMMSS/
///   images/frame_00001.jpg …   les images clés (orientation du capteur, paysage)
///   transforms.json            positions + caméra, au format Nerfstudio (réutilisable pour la reconstruction)
///   points.ply                 le nuage de points ARKit (ouvrable dans MeshLab, CloudCompare, Blender)
///   scan.json                  résumé (date, nombres)
enum ScanStorage {
  static func scansDirectory() throws -> URL {
    let documents = try FileManager.default.url(
      for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let dir = documents.appendingPathComponent("scans", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  /// Matrice 4×4 en liste de lignes (simd est rangé par colonnes).
  private static func rows(_ m: simd_float4x4) -> [[Double]] {
    let c = [m.columns.0, m.columns.1, m.columns.2, m.columns.3]
    return (0..<4).map { r in c.map { Double($0[r]) } }
  }

  static func writeTransforms(frames: [KeyframeRecord], to scanURL: URL) throws {
    var root: [String: Any] = [
      "camera_model": "OPENCV",
      "k1": 0, "k2": 0, "p1": 0, "p2": 0,
      "source": "Scan3D ARKit",
      "coordinate_convention": "ARKit camera-to-world (OpenGL: +X droite, +Y haut, regarde vers -Z), metres",
      "ply_file_path": "points.ply",
    ]
    if let first = frames.first {
      // ARKit range les matrices par colonnes : fx = [0][0], fy = [1][1], cx = [2][0], cy = [2][1].
      root["fl_x"] = Double(first.intrinsics.columns.0.x)
      root["fl_y"] = Double(first.intrinsics.columns.1.y)
      root["cx"] = Double(first.intrinsics.columns.2.x)
      root["cy"] = Double(first.intrinsics.columns.2.y)
      root["w"] = first.width
      root["h"] = first.height
    }
    root["frames"] = frames.map { f -> [String: Any] in
      [
        "file_path": f.filePath,
        "transform_matrix": rows(f.transform),
        "timestamp": f.timestamp,
        // Valeurs par image : l'autofocus peut changer légèrement la focale.
        "fl_x": Double(f.intrinsics.columns.0.x),
        "fl_y": Double(f.intrinsics.columns.1.y),
        "cx": Double(f.intrinsics.columns.2.x),
        "cy": Double(f.intrinsics.columns.2.y),
      ]
    }
    let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: scanURL.appendingPathComponent("transforms.json"), options: .atomic)
  }

  static func writePly(points: [SIMD3<Float>], to url: URL) throws {
    var text = """
      ply
      format ascii 1.0
      element vertex \(points.count)
      property float x
      property float y
      property float z
      end_header

      """
    text.reserveCapacity(text.count + points.count * 32)
    for p in points {
      text += "\(p.x) \(p.y) \(p.z)\n"
    }
    try text.write(to: url, atomically: true, encoding: .utf8)
  }

  static func writeInfo(to scanURL: URL, startedAt: Date, keyframes: Int, points: Int) throws {
    let iso = ISO8601DateFormatter()
    let info: [String: Any] = [
      "name": scanURL.lastPathComponent,
      "startedAt": iso.string(from: startedAt),
      "finishedAt": iso.string(from: Date()),
      "keyframes": keyframes,
      "points": points,
    ]
    let data = try JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: scanURL.appendingPathComponent("scan.json"), options: .atomic)
  }

  static func listScans() -> [[String: Any]] {
    guard let dir = try? scansDirectory(),
      let entries = try? FileManager.default.contentsOfDirectory(
        at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
    else { return [] }

    return entries
      .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
      .sorted { $0.lastPathComponent > $1.lastPathComponent }
      .map { url -> [String: Any] in
        let images = (try? FileManager.default.contentsOfDirectory(atPath: url.appendingPathComponent("images").path)) ?? []
        var item: [String: Any] = [
          "name": url.lastPathComponent,
          "path": url.path,
          "keyframes": images.filter { $0.hasSuffix(".jpg") }.count,
        ]
        if let data = try? Data(contentsOf: url.appendingPathComponent("scan.json")),
          let info = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
          item["points"] = info["points"]
          item["finishedAt"] = info["finishedAt"]
        }
        return item
      }
  }
}
