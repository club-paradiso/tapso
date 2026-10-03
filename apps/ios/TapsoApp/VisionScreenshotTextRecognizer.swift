import CoreGraphics
import Foundation
import ImageIO
import TapsoTransit
import Vision

/// Reads a screenshot's text with Apple's Vision framework, on the device.
///
/// `VNRecognizeTextRequest` (accurate level, Korean and English where the
/// device supports them) never touches the network. The image is decoded from
/// memory, downscaled, read and dropped; nothing is written to disk.
/// Language correction stays off: it "fixes" proper nouns such as stop names,
/// and `StopNameSimilarity` handles near-misses against TAPSO's real stop list.
struct VisionScreenshotTextRecognizer: ScreenshotTextRecognizer {
    /// Longest side after downscaling. A full-screen iPhone screenshot is about 2,800 px; more only costs time.
    static let maxPixelDimension = 3_000
    static let preferredLanguages = ["ko-KR", "en-US"]

    func recognizeText(in imageData: Data) async throws -> RecognizedScreenshotText {
        try await Task.detached(priority: .userInitiated) {
            try Self.recognize(imageData)
        }.value
    }

    private static func recognize(_ imageData: Data) throws -> RecognizedScreenshotText {
        guard let source = CGImageSourceCreateWithData(imageData as CFData, nil) else {
            throw ScreenshotRecognitionError.unreadableImage
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelDimension,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw ScreenshotRecognitionError.unreadableImage
        }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let supported = (try? request.supportedRecognitionLanguages()) ?? []
        let languages = preferredLanguages.filter { supported.contains($0) }
        if !languages.isEmpty { request.recognitionLanguages = languages }

        do {
            try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        } catch {
            throw ScreenshotRecognitionError.recognitionFailed
        }
        return blocks(from: request.results ?? [])
    }

    /// Vision's boxes are normalised with the origin at the bottom left; the core's are top left.
    /// Blocks come back top to bottom, then left to right, the order a rider reads a route list.
    static func blocks(from observations: [VNRecognizedTextObservation]) -> RecognizedScreenshotText {
        let blocks: [RecognizedTextBlock] = observations.compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return RecognizedTextBlock(
                text: candidate.string,
                confidence: Double(candidate.confidence),
                box: NormalizedRect(
                    x: Double(box.minX),
                    y: Double(1 - box.maxY),
                    width: Double(box.width),
                    height: Double(box.height)
                )
            )
        }
        let ordered = blocks.sorted { lhs, rhs in
            guard let left = lhs.box, let right = rhs.box else { return false }
            return left.y != right.y ? left.y < right.y : left.x < right.x
        }
        return RecognizedScreenshotText(blocks: ordered)
    }
}
