import SwiftUI
import XCTest
@testable import Tapso

/// Release gate "Brand integrity" (`docs/exec-plans/TAPSO_V1_RELEASE_CLOSURE.md`).
/// The visual wordmark is TAPSŌ with a precomposed macron; the searchable name stays TAPSO.
@MainActor
final class BrandTests: XCTestCase {
    func testWordmarkIsTapsoWithAPrecomposedMacron() {
        XCTAssertEqual(TapsoBrand.wordmark, "TAPSŌ")
        XCTAssertEqual(Array(TapsoBrand.wordmark.unicodeScalars).map(\.value), [0x54, 0x41, 0x50, 0x53, 0x014C])
        XCTAssertEqual(TapsoBrand.wordmark.count, 5)
        XCTAssertFalse(TapsoBrand.wordmark.contains("/"))
        XCTAssertEqual(TapsoBrand.productName, "TAPSO")
        XCTAssertEqual(TapsoBrand.koreanName, "탑서")
    }

    func testSearchableNameStaysOnTheHomeScreen() {
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String, "TAPSO")
    }

    /// The wordmark renders in one line and without clipping at the compact width and at the
    /// largest accessibility size: its drawn width is the width the view asks for.
    func testWordmarkDoesNotWrapOrClipAtCompactWidthAndLargeType() throws {
        for (width, size) in [(320, DynamicTypeSize.large), (320, .accessibility5), (402, .accessibility5)] {
            let renderer = ImageRenderer(content: BrandWordmark().fixedSize().dynamicTypeSize(size).frame(maxWidth: CGFloat(width), alignment: .leading))
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.uiImage, "width \(width) size \(size)")
            XCTAssertLessThanOrEqual(image.size.width, CGFloat(width), "width \(width) size \(size)")
            XCTAssertLessThan(image.size.height, 120, "one line at width \(width) size \(size)")
        }
    }

    func testBuildIdentityReadsTheBundleAndNamesTheConfiguration() {
        let identity = TapsoBuild.identity()
        XCTAssertFalse(identity.version.isEmpty)
        XCTAssertFalse(identity.build.isEmpty)
        XCTAssertFalse(identity.gitCommit.isEmpty)
        XCTAssertEqual(identity.configuration, "DEBUG")
        XCTAssertTrue(identity.line.hasPrefix("TAPSO "))
        XCTAssertTrue(identity.line.contains("DEBUG"))
    }
}
