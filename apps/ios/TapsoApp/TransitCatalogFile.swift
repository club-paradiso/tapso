import Foundation
import TapsoTransit

/// The canonical catalog as last downloaded, kept in Application Support so
/// destination search works offline and starts instantly. Only bytes that
/// decoded and passed `JejuTransitCatalog.decode` are ever written here.
struct TransitCatalogFile: Sendable {
    let directory: URL

    static var standard: TransitCatalogFile {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return TransitCatalogFile(directory: base.appendingPathComponent("TAPSO", isDirectory: true))
    }

    private var dataURL: URL { directory.appendingPathComponent("jeju-transit-catalog.json") }
    private var tagURL: URL { directory.appendingPathComponent("jeju-transit-catalog.etag") }

    func load() -> (data: Data, etag: String?)? {
        guard let data = try? Data(contentsOf: dataURL) else { return nil }
        let tag = (try? String(contentsOf: tagURL, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (data, tag?.isEmpty == false ? tag : nil)
    }

    func save(_ data: Data, etag: String?) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: dataURL, options: .atomic)
        if let etag {
            try? Data(etag.utf8).write(to: tagURL, options: .atomic)
        } else {
            try? FileManager.default.removeItem(at: tagURL)
        }
    }
}

/// Where the catalog on this phone stands. Search never waits on the network once a copy exists.
enum CatalogStatus: Equatable {
    case idle
    case loading
    /// The copy in use and when the server built it; `refreshFailed` when the last update did not arrive.
    case ready(version: String, generatedAt: String, refreshFailed: Bool)
    case failed(TransitAPIFailure)
}
