import Foundation

/// What a build may show. The synthetic demo (sample ride, scenario controls,
/// the "체험판" chip) exists for development and tests only: a Release build
/// shows riders real Jeju data and nothing else.
enum TapsoBuild {
    #if DEBUG
    static let showsDemo = true
    static let configuration = "DEBUG"
    #else
    static let showsDemo = false
    static let configuration = "RELEASE"
    #endif

    /// What a tester must be able to prove about the phone in their hand:
    /// which commit built it. Shown in the Debug/demo settings sheet only.
    struct Identity: Equatable {
        let version: String
        let build: String
        /// The short Git SHA the build phase wrote into the Info.plist
        /// (`TapsoGitCommit`, `apps/ios/project.yml`); `unknown` when the
        /// sources were not in a Git checkout.
        let gitCommit: String
        let configuration: String

        /// `TAPSO 0.1.0 · Build 1 · a8f5940 · DEBUG`
        var line: String {
            "\(TapsoBrand.productName) \(version) · Build \(build) · \(gitCommit) · \(configuration)"
        }
    }

    static func identity(bundle: Bundle = .main) -> Identity {
        let info = bundle.infoDictionary ?? [:]
        return Identity(
            version: info["CFBundleShortVersionString"] as? String ?? "?",
            build: info["CFBundleVersion"] as? String ?? "?",
            gitCommit: (info["TapsoGitCommit"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "unknown",
            configuration: configuration
        )
    }
}
