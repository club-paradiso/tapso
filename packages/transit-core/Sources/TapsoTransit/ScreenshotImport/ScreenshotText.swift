import Foundation

/// A rectangle in an image, as fractions of its width and height, origin at the top left.
public struct NormalizedRect: Hashable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

/// One piece of text a recogniser found in a screenshot. Untrusted: nothing here
/// is a route or a stop until `RouteImportResolver` has checked it against TAPSO's data.
public struct RecognizedTextBlock: Hashable, Sendable {
    public let text: String
    /// 0...1, as the recogniser reports it.
    public let confidence: Double
    /// Where the text sat, when the recogniser says. Reading order is the order of `RecognizedScreenshotText.blocks`.
    public let box: NormalizedRect?

    public init(text: String, confidence: Double, box: NormalizedRect? = nil) {
        self.text = text
        self.confidence = confidence
        self.box = box
    }
}

/// Everything a recogniser read from one screenshot, top to bottom.
public struct RecognizedScreenshotText: Hashable, Sendable {
    public let blocks: [RecognizedTextBlock]

    public init(blocks: [RecognizedTextBlock]) {
        self.blocks = blocks
    }
}

public enum ScreenshotRecognitionError: Error, Hashable, Sendable {
    /// The data is not an image the device can decode.
    case unreadableImage
    /// The recogniser started and failed.
    case recognitionFailed
}

/// Turns a screenshot into text. The Vision-backed implementation lives in the
/// app target; the matching and validation code never imports Vision.
public protocol ScreenshotTextRecognizer: Sendable {
    func recognizeText(in imageData: Data) async throws -> RecognizedScreenshotText
}
