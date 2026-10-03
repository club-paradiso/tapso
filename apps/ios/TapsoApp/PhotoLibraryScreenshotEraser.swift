import Foundation
import Photos

/// What came of asking Photos to delete the original of a screenshot.
enum OriginalEraseOutcome: Equatable, Sendable {
    case deleted
    /// The rider declined iOS's own confirmation. Nothing happened.
    case cancelled
    /// Photo-library access was refused.
    case denied
    /// Photos does not show this photo to TAPSO (for example, outside a "selected photos" grant).
    case notFound
    case failed
}

/// Deletes the original screenshot from the Photos library, and only when the rider asks.
///
/// TAPSO never stores a screenshot, so there is nothing of its own to delete: this reaches the rider's
/// original in Photos. It needs full photo-library access, which TAPSO asks for only at this moment
/// (never at launch, never for picking a photo). iOS then asks the rider to confirm the deletion and
/// moves the photo to "Recently Deleted"; neither step can be skipped.
protocol ScreenshotOriginalEraser: Sendable {
    func erase(assetIdentifier: String) async -> OriginalEraseOutcome
}

struct PhotoLibraryScreenshotEraser: ScreenshotOriginalEraser {
    func erase(assetIdentifier: String) async -> OriginalEraseOutcome {
        var status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if status == .notDetermined {
            status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        }
        guard status == .authorized || status == .limited else { return .denied }

        guard PHAsset.fetchAssets(withLocalIdentifiers: [assetIdentifier], options: nil).count > 0 else {
            return .notFound
        }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                // Fetched inside the change block: a `PHAsset` is not `Sendable`.
                let assets = PHAsset.fetchAssets(withLocalIdentifiers: [assetIdentifier], options: nil)
                PHAssetChangeRequest.deleteAssets(assets)
            }
            return .deleted
        } catch {
            if (error as? PHPhotosError)?.code == .userCancelled { return .cancelled }
            return .failed
        }
    }
}
