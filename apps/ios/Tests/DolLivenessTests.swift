import SwiftUI
import TapsoTransit
import UIKit
import XCTest
@testable import Tapso

/// 돌이 must actually move on screen in the app (`LIVE_RIDE_RELIABILITY_HOME_V3.md` §7):
/// a pure `DolMotion` that is never redrawn is a still image. These host the real views in a
/// window and compare what is drawn at two instants.
@MainActor
final class DolLivenessTests: XCTestCase {
    private func hostedPixels(of view: some View, size: CGSize, waits: [Double]) async throws -> [Data] {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        window.rootViewController = UIHostingController(rootView: view)
        window.isHidden = false
        defer { window.isHidden = true }
        var frames: [Data] = []
        for wait in waits {
            try await Task.sleep(for: .seconds(wait))
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
            }
            frames.append(try XCTUnwrap(image.pngData()))
        }
        return frames
    }

    func testAnAnimatedDolIsRedrawnOverTime() async throws {
        let frames = try await hostedPixels(
            of: DolBuddy(moment: .checking, size: 120, animated: true).padding(20),
            size: CGSize(width: 200, height: 200),
            waits: [0.6, 0.45]
        )
        XCTAssertNotEqual(frames[0], frames[1], "checking 돌이 glances: two instants half a swing apart differ")
    }

    func testTheRideScreensDolIsRedrawnOverTime() async throws {
        let model = TapsoAppModel(store: JourneyStore(defaults: UserDefaults(suiteName: "tapso.tests.\(UUID().uuidString)")!), liveActivity: nil)
        model.speed = .manual
        model.startDemo()
        await model.confirmVehicle(try XCTUnwrap(model.vehicleCheck.proposals.first))
        XCTAssertEqual(model.guidance?.moment, .riding)
        let frames = try await hostedPixels(
            of: RideView(model: model),
            size: CGSize(width: 393, height: 852),
            waits: [0.8, 1.7]
        )
        XCTAssertNotEqual(frames[0], frames[1], "the riding 돌이 breathes: the ride screen is not a still picture")
    }

    // MARK: Journey rail marker

    /// Luminance (0…1) of the rendered rail at `x` points, vertically centred.
    private func luminance(ofRail rail: JourneyRail, width: CGFloat, atX x: CGFloat) throws -> Double {
        let renderer = ImageRenderer(content: rail.frame(width: width).padding(0))
        renderer.scale = 3
        let image = try XCTUnwrap(renderer.cgImage)
        let px = Int(x * 3), py = image.height / 2
        let context = try XCTUnwrap(CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(image, in: CGRect(x: -px, y: -(image.height - 1 - py), width: image.width, height: image.height))
        let data = try XCTUnwrap(context.data).assumingMemoryBound(to: UInt8.self)
        return (0.2126 * Double(data[0]) + 0.7152 * Double(data[1]) + 0.0722 * Double(data[2])) / 255
    }

    func testTheRailMarkerIsDolNotABus() throws {
        // At progress 0 the marker's centre is at half its width (height 10 → marker 18 pt → x 9).
        let centre = try luminance(ofRail: JourneyRail(progress: 0, role: .journeyActive), width: 300, atX: 9)
        XCTAssertLessThan(centre, 0.3, "돌이's basalt face sits on the rail; the old bus square was a light teal tile with a white glyph")
    }

    func testTheMarkerAdvancesOnlyWithEvidenceAndJumpsWithoutInventedStops() throws {
        let total = 14
        let positions = (0...total).reversed().map { JourneyRail.progress(remaining: $0, total: total) }
        XCTAssertEqual(positions, positions.sorted(), "fewer stops left never moves the marker back")
        // Provider catch-up 12 → 10: one move to exactly where 10 stops puts it.
        XCTAssertEqual(JourneyRail.progress(remaining: 10, total: total), 4.0 / 14, accuracy: 1e-9)
        XCTAssertEqual(JourneyRail.progress(remaining: 12, total: total), 2.0 / 14, accuracy: 1e-9)
        XCTAssertEqual(JourneyRail.progress(remaining: -1, total: total), 0, "an unknown count never draws 돌이 at the destination")
        XCTAssertGreaterThan(JourneyRail.moveDuration, 0.3)
        XCTAssertLessThanOrEqual(JourneyRail.moveDuration, 2, "ActivityKit animates content changes for at most 2 s")
    }
}
