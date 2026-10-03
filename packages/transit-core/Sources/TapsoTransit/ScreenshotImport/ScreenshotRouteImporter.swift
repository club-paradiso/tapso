import Foundation

/// Turns a screenshot into a `ScreenshotReading`: claims to verify, never a route.
///
/// `LocalVisionRouteInterpreter` is the only implementation: it reads on the
/// device. A future remote multimodal interpreter would return the same shape,
/// and its reading would go through the same `RouteImportResolver`: no
/// interpreter's output becomes a route without TAPSO's own data agreeing.
/// Sending a screenshot off the device needs an explicit privacy review first
/// (`docs/product/SCREENSHOT_IMPORT_V1.md`); nothing here does.
public protocol RouteScreenshotInterpreter: Sendable {
    func interpret(imageData: Data) async throws -> ScreenshotReading
}

/// On-device: recogniser → normaliser → extractor.
public struct LocalVisionRouteInterpreter: RouteScreenshotInterpreter {
    private let recognizer: any ScreenshotTextRecognizer

    public init(recognizer: any ScreenshotTextRecognizer) {
        self.recognizer = recognizer
    }

    public func interpret(imageData: Data) async throws -> ScreenshotReading {
        let text = try await recognizer.recognizeText(in: imageData)
        return TransitEntityExtractor.reading(from: ScreenshotTextNormalizer.lines(from: text))
    }
}

/// Where the importer gets TAPSO's real routes. The app backs this with TAPSO's
/// transit API; tests back it with synthetic variants.
public protocol RouteImportCandidateSource: Sendable {
    /// Every official variant of a bus number, with its stops. Empty when TAPSO does not serve the number.
    func variants(forRouteNumber number: String) async throws -> [TransitRoute]
}

/// Screenshot in, verified result out: interpret, fetch the route variants of the
/// numbers read, resolve. Only bus numbers go to the route source; the image and
/// its text stay in this process.
public struct ScreenshotRouteImporter: Sendable {
    private let interpreter: any RouteScreenshotInterpreter
    private let source: any RouteImportCandidateSource
    private let resolver: RouteImportResolver

    public init(
        interpreter: any RouteScreenshotInterpreter,
        source: any RouteImportCandidateSource,
        resolver: RouteImportResolver = RouteImportResolver()
    ) {
        self.interpreter = interpreter
        self.source = source
        self.resolver = resolver
    }

    public func importRoute(from imageData: Data) async -> RouteImportResult {
        let reading: ScreenshotReading
        do {
            reading = try await interpreter.interpret(imageData: imageData)
        } catch is CancellationError {
            return .notFound(.interrupted)
        } catch ScreenshotRecognitionError.unreadableImage {
            return .notFound(.unreadableImage)
        } catch {
            return .notFound(.noTextFound)
        }
        if Task.isCancelled { return .notFound(.interrupted) }

        return await importRoute(from: reading)
    }

    /// A reading made elsewhere on the device, such as the share extension's. It is checked
    /// exactly like one made here: the reading is a claim, TAPSO's route data decides.
    public func importRoute(from reading: ScreenshotReading) async -> RouteImportResult {
        // Nothing to look up unless there is something legible and a number to look up.
        if reading.lineCount == 0 || reading.ocrConfidence < RouteImportResolver.hopelessOCR || reading.busNumbers.isEmpty {
            return resolver.resolve(reading, routes: [])
        }

        // A reading from outside this process is untrusted: never look up more numbers than the extractor keeps.
        let fetched = await variants(for: reading.busNumbers.prefix(TransitEntityExtractor.maxBusNumbers).map(\.number))
        if Task.isCancelled { return .notFound(.interrupted) }
        if fetched.failures == fetched.attempts { return .notFound(.routeDataUnavailable) }
        return resolver.resolve(reading, routes: fetched.routes)
    }

    private func variants(for numbers: [String]) async -> (routes: [TransitRoute], attempts: Int, failures: Int) {
        let source = self.source
        return await withTaskGroup(of: [TransitRoute]?.self, returning: (routes: [TransitRoute], attempts: Int, failures: Int).self) { group in
            for number in numbers {
                group.addTask { try? await source.variants(forRouteNumber: number) }
            }
            var routes: [TransitRoute] = []
            var failures = 0
            for await result in group {
                if let result { routes.append(contentsOf: result) } else { failures += 1 }
            }
            return (routes, numbers.count, failures)
        }
    }
}
