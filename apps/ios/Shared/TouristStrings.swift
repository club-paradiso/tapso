import Foundation

/// The languages the tourist pivot speaks.
///
/// TAPSO's product tables (`Localizable.strings`) stay ko/en and keep following
/// the device locale. The tourist pivot adds a scoped, tourist-facing table in
/// code — `TouristStrings` — because only ~36 keys are translated and every
/// missing key must fall back per key (requested → ko → en), which a
/// `.strings` bundle cannot do. Compiled into `Shared` so the app and the Live
/// Activity extension resolve the same copy.
public enum TouristLanguage: String, CaseIterable, Sendable, Identifiable {
    case ko
    case en
    case zhHans = "zh-Hans"
    case ja

    public var id: String { rawValue }

    /// The device locale decides the default: ko → ko, zh* → Simplified
    /// Chinese, ja → ja, everything else → en (the tourist lingua franca).
    public static func defaultForDeviceLocale(_ locale: Locale = .current) -> TouristLanguage {
        switch locale.language.languageCode?.identifier {
        case "ko": return .ko
        case "zh": return .zhHans
        case "ja": return .ja
        default: return .en
        }
    }

    /// The name each language calls itself; also a table key
    /// (`tourist.language.<rawValue>`) so the picker never needs the device locale.
    public var tableKey: String { "tourist.language.\(rawValue)" }
}

/// The tourist string tables: ko/en/zh/ja for the ~36 keys the tourist pivot
/// needs (language choice, setup, ride, Live Activity, stop guides, alerts).
/// Checked by `scripts/ios/check_tourist_strings.py`: the four languages must
/// hold exactly the same keys, none empty.
///
/// Full translation of the 4,338-stop catalog and the whole product surface is
/// explicitly out of scope; this table covers the tourist journey only.
public enum TouristStrings {
    public static let table: [TouristLanguage: [String: String]] = [
        .ko: [
            "tourist.language.title": "언어",
            "tourist.language.subtitle": "탑서 안내 언어를 선택하세요",
            "tourist.language.automatic": "자동 (기기 설정 따름)",
            "tourist.language.ko": "한국어",
            "tourist.language.en": "English",
            "tourist.language.zh-Hans": "简体中文",
            "tourist.language.ja": "日本語",
            "tourist.home.welcome": "제주에 오신 걸 환영해요",
            "tourist.home.airportHint": "제주국제공항에서 바로 시작할 수 있어요",
            "tourist.home.languageRow": "안내 언어",
            "tourist.setup.destination": "어디에서 내리시나요?",
            "tourist.setup.chooseRoute": "탈 버스를 고르세요",
            "tourist.setup.boardingStop": "어디에서 타시나요?",
            "tourist.setup.confirmBoarding": "버스를 탔어요",
            "tourist.ride.remaining.one": "1개 정류장 남았어요",
            "tourist.ride.remaining.other": "%d개 정류장 남았어요",
            "tourist.ride.nextStop": "다음 정류장: %@",
            "tourist.ride.getOffSoon": "다음 정류장에서 내리세요",
            "tourist.ride.getOffNow": "지금 내리세요!",
            "tourist.ride.arrived.title": "도착했어요",
            "tourist.ride.arrived.body": "%@에 도착했어요",
            "tourist.ride.boardingConfirmed": "승차 확인됐어요. 편히 쉬세요.",
            "tourist.live.title": "하차 알림",
            "tourist.live.stopsLeft.one": "1개 정류장 전",
            "tourist.live.stopsLeft.other": "%d개 정류장 전",
            "tourist.live.getOffAlert": "내릴 시간이에요",
            "tourist.live.hint": "잠금 화면에 띄워 둘게요. 내릴 때가 되면 알려 드려요.",
            "tourist.guide.title": "이 정류장 안내",
            "tourist.guide.empty": "이 정류장의 안내는 준비 중이에요.",
            "tourist.alert.offline.title": "연결이 끊겼어요",
            "tourist.alert.offline.body": "버스 위치를 확인할 수 없어요. 잠시 후 다시 시도할게요.",
            "tourist.alert.stale.title": "정보가 오래됐어요",
            "tourist.alert.stale.body": "버스 위치 정보가 갱신되지 않고 있어요.",
            "tourist.common.ok": "확인",
            "tourist.common.cancel": "취소",
            "tourist.common.done": "완료",
        ],
        .en: [
            "tourist.language.title": "Language",
            "tourist.language.subtitle": "Choose the language for TAPSO guidance",
            "tourist.language.automatic": "Automatic (follow device)",
            "tourist.language.ko": "한국어",
            "tourist.language.en": "English",
            "tourist.language.zh-Hans": "简体中文",
            "tourist.language.ja": "日本語",
            "tourist.home.welcome": "Welcome to Jeju!",
            "tourist.home.airportHint": "You can start right from Jeju International Airport",
            "tourist.home.languageRow": "Guide language",
            "tourist.setup.destination": "Where are you getting off?",
            "tourist.setup.chooseRoute": "Choose your bus",
            "tourist.setup.boardingStop": "Where will you board?",
            "tourist.setup.confirmBoarding": "I'm on the bus",
            "tourist.ride.remaining.one": "1 stop left",
            "tourist.ride.remaining.other": "%d stops left",
            "tourist.ride.nextStop": "Next stop: %@",
            "tourist.ride.getOffSoon": "Get off at the next stop",
            "tourist.ride.getOffNow": "Get off now!",
            "tourist.ride.arrived.title": "You've arrived",
            "tourist.ride.arrived.body": "You've arrived at %@",
            "tourist.ride.boardingConfirmed": "Boarding confirmed. Sit back and relax.",
            "tourist.live.title": "Get-off alerts",
            "tourist.live.stopsLeft.one": "1 stop to go",
            "tourist.live.stopsLeft.other": "%d stops to go",
            "tourist.live.getOffAlert": "Time to get off",
            "tourist.live.hint": "We'll keep this on your Lock Screen and nudge you when it's time.",
            "tourist.guide.title": "About this stop",
            "tourist.guide.empty": "A guide for this stop is coming soon.",
            "tourist.alert.offline.title": "You're offline",
            "tourist.alert.offline.body": "We can't check the bus location right now. We'll retry shortly.",
            "tourist.alert.stale.title": "Information may be outdated",
            "tourist.alert.stale.body": "The bus location hasn't updated for a while.",
            "tourist.common.ok": "OK",
            "tourist.common.cancel": "Cancel",
            "tourist.common.done": "Done",
        ],
        .zhHans: [
            "tourist.language.title": "语言",
            "tourist.language.subtitle": "选择 TAPSO 引导语言",
            "tourist.language.automatic": "自动（跟随设备）",
            "tourist.language.ko": "한국어",
            "tourist.language.en": "English",
            "tourist.language.zh-Hans": "简体中文",
            "tourist.language.ja": "日本語",
            "tourist.home.welcome": "欢迎来到济州！",
            "tourist.home.airportHint": "可直接从济州国际机场开始",
            "tourist.home.languageRow": "引导语言",
            "tourist.setup.destination": "您要在哪里下车？",
            "tourist.setup.chooseRoute": "选择您要乘坐的公交车",
            "tourist.setup.boardingStop": "您要在哪里上车？",
            "tourist.setup.confirmBoarding": "我已上车",
            "tourist.ride.remaining.one": "还剩 1 站",
            "tourist.ride.remaining.other": "还剩 %d 站",
            "tourist.ride.nextStop": "下一站：%@",
            "tourist.ride.getOffSoon": "请在下一站下车",
            "tourist.ride.getOffNow": "请现在下车！",
            "tourist.ride.arrived.title": "您已到达",
            "tourist.ride.arrived.body": "您已到达 %@",
            "tourist.ride.boardingConfirmed": "已确认上车，请放心休息。",
            "tourist.live.title": "下车提醒",
            "tourist.live.stopsLeft.one": "还剩 1 站",
            "tourist.live.stopsLeft.other": "还剩 %d 站",
            "tourist.live.getOffAlert": "到下车时间了",
            "tourist.live.hint": "我们会将其保留在锁定屏幕上，到时间会提醒您。",
            "tourist.guide.title": "本站点介绍",
            "tourist.guide.empty": "本站点的介绍即将推出。",
            "tourist.alert.offline.title": "网络已断开",
            "tourist.alert.offline.body": "目前无法确认公交车位置，稍后会重试。",
            "tourist.alert.stale.title": "信息可能已过期",
            "tourist.alert.stale.body": "公交车位置信息有一段时间没有更新了。",
            "tourist.common.ok": "确定",
            "tourist.common.cancel": "取消",
            "tourist.common.done": "完成",
        ],
        .ja: [
            "tourist.language.title": "言語",
            "tourist.language.subtitle": "TAPSOの案内言語を選択してください",
            "tourist.language.automatic": "自動（デバイス設定に従う）",
            "tourist.language.ko": "한국어",
            "tourist.language.en": "English",
            "tourist.language.zh-Hans": "简体中文",
            "tourist.language.ja": "日本語",
            "tourist.home.welcome": "済州へようこそ！",
            "tourist.home.airportHint": "済州国際空港からすぐ始められます",
            "tourist.home.languageRow": "案内言語",
            "tourist.setup.destination": "どこで降りますか？",
            "tourist.setup.chooseRoute": "乗るバスを選んでください",
            "tourist.setup.boardingStop": "どこで乗りますか？",
            "tourist.setup.confirmBoarding": "バスに乗りました",
            "tourist.ride.remaining.one": "あと1駅です",
            "tourist.ride.remaining.other": "あと%d駅です",
            "tourist.ride.nextStop": "次の停留所：%@",
            "tourist.ride.getOffSoon": "次の停留所で降りてください",
            "tourist.ride.getOffNow": "今降りてください！",
            "tourist.ride.arrived.title": "到着しました",
            "tourist.ride.arrived.body": "%@に到着しました",
            "tourist.ride.boardingConfirmed": "乗車を確認しました。ゆっくりお休みください。",
            "tourist.live.title": "降車アラート",
            "tourist.live.stopsLeft.one": "あと1駅",
            "tourist.live.stopsLeft.other": "あと%d駅",
            "tourist.live.getOffAlert": "降りる時間です",
            "tourist.live.hint": "ロック画面に表示したままにします。時間になったらお知らせします。",
            "tourist.guide.title": "この停留所について",
            "tourist.guide.empty": "この停留所のガイドは準備中です。",
            "tourist.alert.offline.title": "オフラインです",
            "tourist.alert.offline.body": "バスの位置を確認できません。しばらくしてから再試行します。",
            "tourist.alert.stale.title": "情報が古い可能性があります",
            "tourist.alert.stale.body": "バスの位置情報がしばらく更新されていません。",
            "tourist.common.ok": "OK",
            "tourist.common.cancel": "キャンセル",
            "tourist.common.done": "完了",
        ],
    ]
}

/// Resolves tourist strings with an explicit fallback chain: the requested
/// language → ko (the product's source language) → en (the tourist lingua
/// franca) → the key itself, so the UI never renders an empty string.
public enum TouristText {
    public static func string(_ key: String, language: TouristLanguage) -> String {
        if let hit = TouristStrings.table[language]?[key], !hit.isEmpty { return hit }
        if language != .ko, let ko = TouristStrings.table[.ko]?[key], !ko.isEmpty { return ko }
        if language != .en, let en = TouristStrings.table[.en]?[key], !en.isEmpty { return en }
        return key
    }

    public static func format(_ key: String, language: TouristLanguage, _ args: CVarArg...) -> String {
        String(format: string(key, language: language), arguments: args)
    }

    /// The singular variant (`<key>.one`) for a count of one, mirroring `RideText.countKey`.
    public static func countKey(_ key: String, _ count: Int) -> String {
        count == 1 ? key + ".one" : key + ".other"
    }
}
