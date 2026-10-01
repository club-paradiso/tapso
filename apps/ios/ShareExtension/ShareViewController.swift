import SwiftUI
import TapsoTransit
import UIKit

/// TAPSO in the share sheet of KakaoMap, NAVER Map, Apple Maps or any app that
/// shares text or a link.
///
/// What it does, and nothing more (`docs/product/MAP_HANDOFF_V3.md`):
/// - reads the shared text and links on the device with `SharedPlaceParser`,
///   never fetching a link;
/// - leaves the parsed place, never the raw text, in the App Group for the app
///   (`HandoffInbox`), because a share extension cannot open its containing app;
/// - when the App Group is not provisioned, offers a copy the rider pastes in TAPSO.
final class ShareViewController: UIViewController {
    private let model = ShareModel(inbox: HandoffInbox.shared())

    override func viewDidLoad() {
        super.viewDidLoad()
        model.onFinish = { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
        let host = UIHostingController(rootView: ShareSheetView(model: model))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)

        model.receive(extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? [])
    }
}
