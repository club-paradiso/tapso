import Foundation

// Multilingual one-line guides for the tourist pivot: the ~30 stops foreign
// visitors use most, each keyed to the canonical catalog by provider stop ID
// (`JejuTransitCatalog.Stop.id`, e.g. "JEB405000663") and carrying the exact
// catalog stop name so the app can join guides to search results and rides.
//
// SCOPE NOTE: translating all 4,338 catalog stops is explicitly out of scope.
// This file curates the top tourist stops only (airports, beaches, UNESCO
// sites, Hallasan trailheads, markets, resort hubs). Descriptions are en/zh/ja
// one-liners; Korean needs no blurb — the catalog's Korean stop name is the
// guide. Spot names are given in all four languages so tourists can match
// signage.
//
// The data is UI-independent on purpose: the app reads it through
// `touristGuide(forStopId:)` in the rider's `JourneyLanguage`; the surrounding
// interface is localized in `apps/ios/Resources/<lang>.lproj`. Every id and
// Korean name is checked against `services/api/data/jeju-transit-catalog.json`
// (`TouristStopGuidesTests`). Descriptions are machine-reviewed, not
// professionally translated (docs/beta/LOCALIZATION_AUDIT.md).

/// One tourist stop: catalog identity plus en/zh/ja one-line descriptions.
public struct TouristStopGuide: Codable, Hashable, Sendable {
    /// Provider stop ID from the canonical Jeju catalog (never collapsed).
    public let stopId: String
    /// The exact stop name in the catalog (Korean), for joining to search/ride UI.
    public let stopNameKo: String
    public let spotNameKo: String
    public let spotNameEn: String
    public let spotNameZh: String
    public let spotNameJa: String
    /// One-line en/zh/ja descriptions. Korean is intentionally absent: the
    /// catalog name is the Korean guide.
    public let blurbEn: String
    public let blurbZh: String
    public let blurbJa: String

    public init(
        stopId: String,
        stopNameKo: String,
        spotNameKo: String,
        spotNameEn: String,
        spotNameZh: String,
        spotNameJa: String,
        blurbEn: String,
        blurbZh: String,
        blurbJa: String
    ) {
        self.stopId = stopId
        self.stopNameKo = stopNameKo
        self.spotNameKo = spotNameKo
        self.spotNameEn = spotNameEn
        self.spotNameZh = spotNameZh
        self.spotNameJa = spotNameJa
        self.blurbEn = blurbEn
        self.blurbZh = blurbZh
        self.blurbJa = blurbJa
    }

    /// The one-line description for a tourist language (ko falls back to the
    /// catalog stop name, which is already Korean).
    public func blurb(for language: JourneyLanguage) -> String {
        switch language {
        case .ko: return stopNameKo
        case .en: return blurbEn
        case .zhHans: return blurbZh
        case .ja: return blurbJa
        }
    }

    /// The spot's name in a journey language, for matching what a tourist types or reads on a sign.
    public func spotName(for language: JourneyLanguage) -> String {
        switch language {
        case .ko: return spotNameKo
        case .en: return spotNameEn
        case .zhHans: return spotNameZh
        case .ja: return spotNameJa
        }
    }

    /// Whether `query` (already trimmed) names this spot in any of the four languages.
    /// Latin queries need two characters; one Han or kana character is already a word.
    public func matches(_ query: String) -> Bool {
        let needle = query.lowercased()
        guard needle.count >= (needle.allSatisfy(\.isASCII) ? 2 : 1) else { return false }
        return [spotNameKo, spotNameEn, spotNameZh, spotNameJa].contains { $0.lowercased().contains(needle) }
    }
}

/// The curated tourist stops. One canonical pole per spot — where a spot has
/// several poles/directions, the most-used boarding/alighting one is chosen.
public let allTouristStopGuides: [TouristStopGuide] = [
    TouristStopGuide(
        stopId: "JEB405000663",
        stopNameKo: "제주국제공항3(용담,시청)[북]",
        spotNameKo: "제주국제공항",
        spotNameEn: "Jeju International Airport",
        spotNameZh: "济州国际机场",
        spotNameJa: "済州国際空港",
        blurbEn: "Jeju's gateway airport, about 10 minutes by bus from downtown Jeju City.",
        blurbZh: "济州的空中门户，乘公交约10分钟可达济州市区。",
        blurbJa: "済州の空の玄関口。バスで済州市内まで約10分。"
    ),
    TouristStopGuide(
        stopId: "JEB405000198",
        stopNameKo: "함덕환승정류장(함덕해수욕장)[북]",
        spotNameKo: "함덕해수욕장",
        spotNameEn: "Hamdeok Beach",
        spotNameZh: "咸德海水浴场",
        spotNameJa: "咸徳海水浴場",
        blurbEn: "Emerald-water beach with a shallow sandy shore, popular for swimming and sunsets.",
        blurbZh: "以翡翠色海水和浅滩闻名的海水浴场，适合游泳和看日落。",
        blurbJa: "エメラルド色の海と遠浅の砂浜で人気の海水浴場。夕日も美しい。"
    ),
    TouristStopGuide(
        stopId: "JEB406000816",
        stopNameKo: "성산일출봉입구[동]",
        spotNameKo: "성산일출봉",
        spotNameEn: "Seongsan Ilchulbong",
        spotNameZh: "城山日出峰",
        spotNameJa: "城山日出峰",
        blurbEn: "UNESCO-listed tuff crater rising from the sea, famous for sunrise views.",
        blurbZh: "被列入联合国教科文组织名录的凝灰岩火山口，以日出景观闻名。",
        blurbJa: "ユネスコ登録の凝灰岩火口丘。日の出の名所として知られる。"
    ),
    TouristStopGuide(
        stopId: "JEB405000812",
        stopNameKo: "만장굴입구",
        spotNameKo: "만장굴",
        spotNameEn: "Manjanggul Lava Cave",
        spotNameZh: "万丈窟",
        spotNameJa: "万丈窟",
        blurbEn: "One of the world's longest lava tubes — a cool walk through volcanic history.",
        blurbZh: "世界最长的熔岩洞穴之一，在凉爽的洞内感受火山历史。",
        blurbJa: "世界有数の溶岩洞窟。涼しい洞内を歩きながら火山の歴史を体感。"
    ),
    TouristStopGuide(
        stopId: "JEB405001251",
        stopNameKo: "협재해수욕장[동]",
        spotNameKo: "협재해수욕장",
        spotNameEn: "Hyeopjae Beach",
        spotNameZh: "挟才海水浴场",
        spotNameJa: "挟才海水浴場",
        blurbEn: "White-sand beach with clear shallow water, facing Biyangdo Island.",
        blurbZh: "面对飞扬岛的白沙海滩，海水清澈浅平。",
        blurbJa: "飛揚島を望む白砂のビーチ。透明度の高い遠浅の海。"
    ),
    TouristStopGuide(
        stopId: "JEB406001522",
        stopNameKo: "중문관광단지",
        spotNameKo: "중문관광단지",
        spotNameEn: "Jungmun Tourist Complex",
        spotNameZh: "中文旅游区",
        spotNameJa: "中文観光団地",
        blurbEn: "Resort complex with beaches, waterfalls and museums clustered together.",
        blurbZh: "集海滩、瀑布和博物馆于一体的度假综合区。",
        blurbJa: "ビーチや滝、博物館が集まるリゾートエリア。"
    ),
    TouristStopGuide(
        stopId: "JEB406000502",
        stopNameKo: "천지연폭포(종점)",
        spotNameKo: "천지연폭포",
        spotNameEn: "Cheonjiyeon Waterfall",
        spotNameZh: "天地渊瀑布",
        spotNameJa: "天地淵瀑布",
        blurbEn: "A lush valley waterfall in Seogwipo, lit up beautifully at night.",
        blurbZh: "位于西归浦的幽静瀑布，夜间灯光别具韵味。",
        blurbJa: "西帰浦の緑豊かな渓谷の滝。夜のライトアップも美しい。"
    ),
    TouristStopGuide(
        stopId: "JEB406001405",
        stopNameKo: "섭지코지",
        spotNameKo: "섭지코지",
        spotNameEn: "Seopjikoji",
        spotNameZh: "涉地可支",
        spotNameJa: "渉地岬",
        blurbEn: "Dramatic coastal cape with a lighthouse and sweeping ocean views.",
        blurbZh: "拥有灯塔的海岸岬角，可欣赏壮阔的海景。",
        blurbJa: "灯台が立つ海岸の岬。雄大な海の景色が広がる。"
    ),
    TouristStopGuide(
        stopId: "JEB406000684",
        stopNameKo: "성산항",
        spotNameKo: "성산항 (우도행)",
        spotNameEn: "Seongsan Port (Udo Ferry)",
        spotNameZh: "城山港（牛岛渡轮）",
        spotNameJa: "城山港（牛島フェリー）",
        blurbEn: "Ferry terminal for Udo Island, with boats departing throughout the day.",
        blurbZh: "前往牛岛的渡轮码头，全天有船班往返。",
        blurbJa: "牛島行きフェリーの港。日中は便が運航している。"
    ),
    TouristStopGuide(
        stopId: "JEB406001215",
        stopNameKo: "오설록",
        spotNameKo: "오설록 티뮤지엄",
        spotNameEn: "O'sulloc Tea Museum",
        spotNameZh: "O'sulloc 茶博物馆",
        spotNameJa: "オソルロク ティーミュージアム",
        blurbEn: "Green-tea museum and fields where you can taste fresh Jeju matcha.",
        blurbZh: "绿茶博物馆和茶园，可品尝新鲜的济州抹茶。",
        blurbJa: "緑茶ミュージアムと茶畑。新鮮な済州抹茶を味わえる。"
    ),
    TouristStopGuide(
        stopId: "JEB405001341",
        stopNameKo: "김녕해수욕장",
        spotNameKo: "김녕해수욕장",
        spotNameEn: "Gimnyeong Beach",
        spotNameZh: "金宁海水浴场",
        spotNameJa: "金寧海水浴場",
        blurbEn: "Quiet beach with windmills on the horizon and a calm swimming cove.",
        blurbZh: "远处可见风车的安静海滩，海湾平静适合游泳。",
        blurbJa: "風車が見える静かなビーチ。穏やかな入り江で泳げる。"
    ),
    TouristStopGuide(
        stopId: "JEB405001335",
        stopNameKo: "월정리",
        spotNameKo: "월정리해변",
        spotNameEn: "Woljeongri Beach",
        spotNameZh: "月汀里海滩",
        spotNameJa: "月汀里ビーチ",
        blurbEn: "Trendy beach street lined with cafes, facing a turquoise sea.",
        blurbZh: "面朝碧绿大海、咖啡馆林立的时尚海滩街。",
        blurbJa: "カフェが並ぶおしゃれなビーチストリート。ターコイズブルーの海。"
    ),
    TouristStopGuide(
        stopId: "JEB405000153",
        stopNameKo: "제주버스터미널[남]",
        spotNameKo: "제주버스터미널",
        spotNameEn: "Jeju Bus Terminal",
        spotNameZh: "济州巴士总站",
        spotNameJa: "済州バスターミナル",
        blurbEn: "The island's main bus hub — most intercity routes start here.",
        blurbZh: "济州岛主要的公交枢纽，大多数市外线路从这里出发。",
        blurbJa: "島のバスターミナル。多くの都市間バスがここから出発する。"
    ),
    TouristStopGuide(
        stopId: "JEB406000711",
        stopNameKo: "서귀포버스터미널",
        spotNameKo: "서귀포버스터미널",
        spotNameEn: "Seogwipo Bus Terminal",
        spotNameZh: "西归浦巴士总站",
        spotNameJa: "西帰浦バスターミナル",
        blurbEn: "Main bus hub for Seogwipo City and the south coast.",
        blurbZh: "西归浦市及南海岸地区的主要公交枢纽。",
        blurbJa: "西帰浦市と南海岸エリアのバスの拠点。"
    ),
    TouristStopGuide(
        stopId: "JEB406001109",
        stopNameKo: "1100고지휴게소[북]",
        spotNameKo: "1100고지",
        spotNameEn: "1100 Highland",
        spotNameZh: "1100高地",
        spotNameJa: "1100高地",
        blurbEn: "A highland rest stop on the mountain road with panoramic views.",
        blurbZh: "位于汉拿山山路上的高原休息站，可俯瞰全景。",
        blurbJa: "漢拏山の山道にある高原の休憩所。パノラマビューが楽しめる。"
    ),
    TouristStopGuide(
        stopId: "JEB405001365",
        stopNameKo: "어리목[북]",
        spotNameKo: "어리목 (한라산)",
        spotNameEn: "Eorimok Trail (Hallasan)",
        spotNameZh: "御里牧登山口（汉拿山）",
        spotNameJa: "御里牧登山口（漢拏山）",
        blurbEn: "Trailhead for Hallasan hikes through forest and alpine meadows.",
        blurbZh: "汉拿山登山的起点之一，穿越森林和高山草甸。",
        blurbJa: "漢拏山登山の登山口。森や高山植物の中を歩くコース。"
    ),
    TouristStopGuide(
        stopId: "JEB405001369",
        stopNameKo: "성판악[동]",
        spotNameKo: "성판악 (한라산)",
        spotNameEn: "Seongpanak Trail (Hallasan)",
        spotNameZh: "城板岳登山口（汉拿山）",
        spotNameJa: "城板岳登山口（漢拏山）",
        blurbEn: "The most popular Hallasan summit trailhead on the east side.",
        blurbZh: "东侧最受欢迎的汉拿山主峰登山起点。",
        blurbJa: "東側で最も人気の漢拏山頂上登山口。"
    ),
    TouristStopGuide(
        stopId: "JEB405000289",
        stopNameKo: "동문로터리, 동문시장[북]",
        spotNameKo: "동문시장",
        spotNameEn: "Dongmun Traditional Market",
        spotNameZh: "东门传统市场",
        spotNameJa: "東門伝統市場",
        blurbEn: "Jeju City's traditional market for street food and local produce.",
        blurbZh: "济州市的传统市场，可品尝街头小吃和购买当地特产。",
        blurbJa: "済州市の伝統市場。屋台グルメや地元の特産品が並ぶ。"
    ),
    TouristStopGuide(
        stopId: "JEB406001804",
        stopNameKo: "매일올레시장 7번입구",
        spotNameKo: "서귀포매일올레시장",
        spotNameEn: "Seogwipo Maeil Olle Market",
        spotNameZh: "西归浦每日偶来市场",
        spotNameJa: "西帰浦毎日オルレ市場",
        blurbEn: "Seogwipo's daily market, famous for fresh seafood and snacks.",
        blurbZh: "西归浦的每日市场，以新鲜海鲜和小吃闻名。",
        blurbJa: "西帰浦の毎日開かれる市場。新鮮な海産物や軽食で有名。"
    ),
    TouristStopGuide(
        stopId: "JEB406000701",
        stopNameKo: "제주민속촌(종점)",
        spotNameKo: "제주민속촌",
        spotNameEn: "Jeju Folk Village",
        spotNameZh: "济州民俗村",
        spotNameJa: "済州民俗村",
        blurbEn: "Open-air museum recreating 19th-century Jeju village life.",
        blurbZh: "再现19世纪济州村庄生活的露天博物馆。",
        blurbJa: "19世紀の済州の村の暮らしを再現した野外博物館。"
    ),
    TouristStopGuide(
        stopId: "JEB406001724",
        stopNameKo: "휴애리 자연생활공원",
        spotNameKo: "휴애리 자연생활공원",
        spotNameEn: "Hueree Nature Park",
        spotNameZh: "休爱里自然生活公园",
        spotNameJa: "ヒュエリ自然生活公園",
        blurbEn: "Nature park with seasonal flowers, animals and folk performances.",
        blurbZh: "拥有季节花卉、动物和民俗表演的自然公园。",
        blurbJa: "季節の花や動物、民俗公演が楽しめる自然公園。"
    ),
    TouristStopGuide(
        stopId: "JEB405001177",
        stopNameKo: "산굼부리[남]",
        spotNameKo: "산굼부리",
        spotNameEn: "Sangumburi Crater",
        spotNameZh: "山君不离火山口",
        spotNameJa: "山君不離",
        blurbEn: "A rare crater you can walk around, covered in silver grass.",
        blurbZh: "可环绕步行的火山口，芒草覆盖，景色独特。",
        blurbJa: "歩いて一周できる火口。ススキに覆われた珍しい景観。"
    ),
    TouristStopGuide(
        stopId: "JEB405001375",
        stopNameKo: "제주돌문화공원[동]",
        spotNameKo: "제주돌문화공원",
        spotNameEn: "Jeju Stone Park",
        spotNameZh: "济州石头文化公园",
        spotNameJa: "済州石文化公園",
        blurbEn: "Park celebrating Jeju's volcanic stone culture and legends.",
        blurbZh: "展现济州火山石文化与传说的主题公园。",
        blurbJa: "済州の火山石文化と伝説を紹介する公園。"
    ),
    TouristStopGuide(
        stopId: "JEB406001573",
        stopNameKo: "제주항공우주박물관",
        spotNameKo: "제주항공우주박물관",
        spotNameEn: "Jeju Aerospace Museum",
        spotNameZh: "济州航空宇宙博物馆",
        spotNameJa: "済州航空宇宙博物館",
        blurbEn: "Hands-on museum of aviation and space, great for families.",
        blurbZh: "寓教于乐的航空航天博物馆，适合家庭游览。",
        blurbJa: "航空と宇宙を体験できる博物館。家族連れにおすすめ。"
    ),
    TouristStopGuide(
        stopId: "JEB405000518",
        stopNameKo: "한라수목원[동]",
        spotNameKo: "한라수목원",
        spotNameEn: "Halla Arboretum",
        spotNameZh: "汉拿树木园",
        spotNameJa: "漢拏樹木園",
        blurbEn: "A peaceful botanical garden of Jeju's native plants.",
        blurbZh: "展示济州本土植物的静谧植物园。",
        blurbJa: "済州の自生植物を集めた静かな植物園。"
    ),
    TouristStopGuide(
        stopId: "JEB405001253",
        stopNameKo: "한림공원[동]",
        spotNameKo: "한림공원",
        spotNameEn: "Hallim Park",
        spotNameZh: "翰林公园",
        spotNameJa: "翰林公園",
        blurbEn: "Botanical garden with lava caves and subtropical plants.",
        blurbZh: "拥有熔岩洞穴和亚热带植物的植物园。",
        blurbJa: "溶岩洞窟と亜熱帯植物がある植物園。"
    ),
    TouristStopGuide(
        stopId: "JEB405001745",
        stopNameKo: "금능해수욕장",
        spotNameKo: "금능해수욕장",
        spotNameEn: "Geumneung Beach",
        spotNameZh: "金陵海水浴场",
        spotNameJa: "金陵海水浴場",
        blurbEn: "Calm, shallow beach next to Hallim Park, good for families.",
        blurbZh: "翰林公园旁平静浅平的海滩，适合家庭游玩。",
        blurbJa: "翰林公園近くの穏やかで遠浅のビーチ。家族連れに人気。"
    ),
    TouristStopGuide(
        stopId: "JEB405001207",
        stopNameKo: "곽지해수욕장[서]",
        spotNameKo: "곽지해수욕장",
        spotNameEn: "Gwakji Beach",
        spotNameZh: "郭支海水浴场",
        spotNameJa: "郭支海水浴場",
        blurbEn: "Small local beach with dark sand and clear water.",
        blurbZh: "拥有深色沙滩和清澈海水的小型本地海滩。",
        blurbJa: "黒っぽい砂と透明な海の小さな地元のビーチ。"
    ),
    TouristStopGuide(
        stopId: "JEB406001626",
        stopNameKo: "쇠소깍하효항입구",
        spotNameKo: "쇠소깍",
        spotNameEn: "Soesokkak Estuary",
        spotNameZh: "索索卡克河口",
        spotNameJa: "ソェソッカク",
        blurbEn: "Scenic estuary where you can kayak between lava cliffs.",
        blurbZh: "可在熔岩峭壁间划皮划艇的风景河口。",
        blurbJa: "溶岩の崖の間をカヤックで進める景勝地の河口。"
    ),
    TouristStopGuide(
        stopId: "JEB406000124",
        stopNameKo: "외돌개",
        spotNameKo: "외돌개",
        spotNameEn: "Oedolgae",
        spotNameZh: "外多尔盖",
        spotNameJa: "ウェドルゲ",
        blurbEn: "Iconic sea-stack rock, a filming site for Korean dramas.",
        blurbZh: "标志性的海蚀柱，曾是多部韩剧的取景地。",
        blurbJa: "韓国ドラマのロケ地としても知られる奇岩。"
    ),
]

/// The guide for a catalog stop ID, or `nil` when the stop has no curated guide
/// (the 4,338-stop catalog is not fully translated — see the scope note above).
public func touristGuide(forStopId stopId: String) -> TouristStopGuide? {
    allTouristStopGuides.first { $0.stopId == stopId }
}
