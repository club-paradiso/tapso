import Foundation
import TapsoTransit
import XCTest

/// Map hand-off parsing. Every payload below is SYNTHETIC, written in the shapes
/// `docs/product/MAP_HANDOFF_V3.md` documents and labels; none was captured from
/// a rider's phone. Coordinates are rounded Jeju points.
final class SharedPlaceTests: XCTestCase {
    func testKakaoMapShareTextGivesNameAndAddressAndKeepsTheShortLinkUnfetched() throws {
        let place = try XCTUnwrap(SharedPlaceParser.parse(text: "[카카오맵] 협재해수욕장\n제주특별자치도 제주시 한림읍 협재리 2497-1\nhttps://kko.to/SynThetic1"))
        XCTAssertEqual(place.source, .kakaoMap)
        XCTAssertEqual(place.name, "협재해수욕장")
        XCTAssertEqual(place.address, "제주특별자치도 제주시 한림읍 협재리 2497-1")
        XCTAssertNil(place.coordinate, "a short link is never resolved on the phone")
        XCTAssertEqual(place.unresolvedLink, "https://kko.to/SynThetic1")
        XCTAssertFalse(place.isLinkOnly)
    }

    func testNaverMapShareTextWithTheTagOnItsOwnLine() throws {
        let place = try XCTUnwrap(SharedPlaceParser.parse(text: "[네이버 지도]\n종달리\n제주특별자치도 제주시 구좌읍 종달리 1234\nhttps://naver.me/SynThetic2"))
        XCTAssertEqual(place.source, .naverMap)
        XCTAssertEqual(place.name, "종달리")
        XCTAssertEqual(place.address, "제주특별자치도 제주시 구좌읍 종달리 1234")
    }

    func testAppleMapsLegacyLinkPinsTheNamedPlace() throws {
        let place = try XCTUnwrap(SharedPlaceParser.parse(text: nil, urls: ["https://maps.apple.com/?q=%ED%98%91%EC%9E%AC&ll=33.3940,126.2397"]))
        XCTAssertEqual(place.source, .appleMaps)
        XCTAssertEqual(place.name, "협재")
        XCTAssertEqual(place.coordinate, Coordinate(latitude: 33.3940, longitude: 126.2397))
        XCTAssertEqual(place.isInJeju, true)
    }

    func testAppleMapsUnifiedPlaceAndDirectionsLinks() throws {
        let card = try XCTUnwrap(SharedPlaceParser.parse(text: nil, urls: [
            "https://maps.apple.com/place?coordinate=33.5560,126.7960&name=%EC%84%B8%ED%99%94%ED%95%B4%EB%B3%80",
        ]))
        XCTAssertEqual(card.name, "세화해변")
        XCTAssertEqual(card.coordinate, Coordinate(latitude: 33.5560, longitude: 126.7960))

        let directions = try XCTUnwrap(SharedPlaceParser.parse(text: nil, urls: [
            "https://maps.apple.com/directions?destination=33.4590,126.9420&mode=transit",
        ]))
        XCTAssertEqual(directions.coordinate, Coordinate(latitude: 33.4590, longitude: 126.9420))

        let search = try XCTUnwrap(SharedPlaceParser.parse(text: nil, urls: ["https://maps.apple.com/search?query=%EC%B9%B4%ED%8E%98&center=33.5,126.5"]))
        XCTAssertEqual(search.name, "카페")
        XCTAssertNil(search.coordinate, "a search centre is not the place")
    }

    func testNaverAndKakaoAppSchemesAndGeoURIs() throws {
        let naver = try XCTUnwrap(SharedPlaceParser.parse(text: nil, urls: ["nmap://place?lat=33.3940&lng=126.2397&name=%ED%98%91%EC%9E%AC&appname=com.example"]))
        XCTAssertEqual(naver.source, .naverMap)
        XCTAssertEqual(naver.name, "협재")
        XCTAssertEqual(naver.coordinate, Coordinate(latitude: 33.3940, longitude: 126.2397))

        let kakao = try XCTUnwrap(SharedPlaceParser.parse(text: nil, urls: ["kakaomap://route?ep=33.4996,126.5312&by=PUBLICTRANSIT"]))
        XCTAssertEqual(kakao.source, .kakaoMap)
        XCTAssertEqual(kakao.coordinate, Coordinate(latitude: 33.4996, longitude: 126.5312))

        let kakaoWeb = try XCTUnwrap(SharedPlaceParser.parse(text: nil, urls: ["https://map.kakao.com/link/map/%EA%B3%BD%EC%A7%80%ED%95%B4%EB%B3%80,33.4500,126.3050"]))
        XCTAssertEqual(kakaoWeb.name, "곽지해변")
        XCTAssertEqual(kakaoWeb.coordinate, Coordinate(latitude: 33.4500, longitude: 126.3050))

        let geo = try XCTUnwrap(SharedPlaceParser.parse(text: "geo:33.2,126.3"))
        XCTAssertEqual(geo.source, .geoURI)
        XCTAssertEqual(geo.coordinate, Coordinate(latitude: 33.2, longitude: 126.3))
    }

    func testEveryKakaoWebLinkShapeInItsGuide() throws {
        let base = "https://map.kakao.com/link/"
        let gwakji = "%EA%B3%BD%EC%A7%80%ED%95%B4%EB%B3%80"
        let point = Coordinate(latitude: 33.4500, longitude: 126.3050)

        XCTAssertEqual(SharedPlaceParser.parse(text: nil, urls: [base + "map/33.4500,126.3050"])?.coordinate, point)
        XCTAssertEqual(SharedPlaceParser.parse(text: nil, urls: [base + "roadview/33.4500,126.3050"])?.coordinate, point)

        let from = try XCTUnwrap(SharedPlaceParser.parse(text: nil, urls: [base + "from/SYN,33.5000,126.5000/to/\(gwakji),33.4500,126.3050"]))
        XCTAssertEqual(from.name, "곽지해변", "the destination, not the origin")
        XCTAssertEqual(from.coordinate, point)

        let walk = try XCTUnwrap(SharedPlaceParser.parse(text: nil, urls: [base + "by/walk/SYN,33.5000,126.5000/\(gwakji),33.4500,126.3050"]))
        XCTAssertEqual(walk.name, "곽지해변")
        XCTAssertEqual(walk.coordinate, point)

        let placeID = try XCTUnwrap(SharedPlaceParser.parse(text: nil, urls: [base + "map/18577297"]))
        XCTAssertTrue(placeID.isLinkOnly, "a place id needs the network, which TAPSO never uses for this")

        XCTAssertEqual(SharedPlaceParser.parse(text: nil, urls: [base + "search/\(gwakji)"])?.name, "곽지해변")
    }

    func testCoordinatesInTextEvenWhenWrittenLongitudeFirst() throws {
        XCTAssertEqual(SharedPlaceParser.parse(text: "33.4996, 126.5312")?.coordinate, Coordinate(latitude: 33.4996, longitude: 126.5312))
        XCTAssertEqual(SharedPlaceParser.parse(text: "126.5312,33.4996")?.coordinate, Coordinate(latitude: 33.4996, longitude: 126.5312))
    }

    func testAPlaceOutsideJejuIsSaidToBeOutsideJeju() throws {
        let seoul = try XCTUnwrap(SharedPlaceParser.parse(text: "서울시청\n37.5665, 126.9780"))
        XCTAssertEqual(seoul.isInJeju, false)
        XCTAssertEqual(seoul.name, "서울시청")
        for point in [Coordinate(latitude: 33.11, longitude: 126.27), Coordinate(latitude: 33.96, longitude: 126.30), Coordinate(latitude: 33.50, longitude: 126.95)] {
            XCTAssertTrue(JejuRegion.contains(point), "Marado, Chuja and Udo are Jeju: \(point)")
        }
    }

    func testABareLinkIsLinkOnlyAndNothingIsNothing() throws {
        let bare = try XCTUnwrap(SharedPlaceParser.parse(text: "https://naver.me/SynThetic3"))
        XCTAssertTrue(bare.isLinkOnly)
        XCTAssertEqual(bare.source, .naverMap)
        XCTAssertNil(SharedPlaceParser.parse(text: "   \n  "))
        XCTAssertNil(SharedPlaceParser.parse(text: nil, urls: []))
    }

    func testAPlainNameIsAName() throws {
        let place = try XCTUnwrap(SharedPlaceParser.parse(text: "  비자림  "))
        XCTAssertEqual(place.source, .text)
        XCTAssertEqual(place.name, "비자림")
        XCTAssertEqual(place.searchText, "비자림")
    }

    func testTheInboxHandsOverOncePrivatelyAndExpires() throws {
        let suite = "tapso.tests.handoff.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let inbox = HandoffInbox(defaults: defaults)
        let place = SharedPlace(source: .kakaoMap, name: "협재해수욕장", address: "제주특별자치도 제주시 한림읍 협재리 2497-1")
        let saved = Date(timeIntervalSince1970: 1_800_000_000)

        inbox.put(place, at: saved)
        XCTAssertEqual(inbox.take(now: saved.addingTimeInterval(60)), place)
        XCTAssertNil(inbox.take(now: saved.addingTimeInterval(61)), "read once")

        inbox.put(place, at: saved)
        XCTAssertNil(inbox.take(now: saved.addingTimeInterval(HandoffInbox.lifetime + 1)), "expired")
        inbox.put(place, at: saved)
        XCTAssertNil(inbox.take(now: saved.addingTimeInterval(-3_600)), "dated in the future")

        XCTAssertTrue((defaults.persistentDomain(forName: suite) ?? [:]).isEmpty, "nothing lingers after it is taken")
    }

    func testAScreenshotReadingTravelsTheSameWayAndReplacesAWaitingPlace() throws {
        let suite = "tapso.tests.handoff.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let inbox = HandoffInbox(defaults: defaults)
        let reading = ScreenshotImportFixtures.reading(ScreenshotImportFixtures.kakaoLight)
        let place = SharedPlace(source: .kakaoMap, name: "합성 카페")
        let saved = Date(timeIntervalSince1970: 1_800_000_000)

        inbox.put(reading, at: saved)
        XCTAssertEqual(inbox.takeReading(now: saved.addingTimeInterval(60)), reading)
        XCTAssertNil(inbox.takeReading(now: saved.addingTimeInterval(61)), "read once")

        inbox.put(reading, at: saved)
        XCTAssertNil(inbox.takeReading(now: saved.addingTimeInterval(HandoffInbox.lifetime + 1)), "expired")
        inbox.put(reading, at: saved)
        XCTAssertNil(inbox.takeReading(now: saved.addingTimeInterval(-3_600)), "dated in the future")

        inbox.put(reading, at: saved)
        inbox.put(place, at: saved)
        XCTAssertNil(inbox.takeReading(now: saved), "a place replaces a waiting reading")
        inbox.put(place, at: saved)
        inbox.put(reading, at: saved)
        XCTAssertNil(inbox.take(now: saved), "a reading replaces a waiting place")
        _ = inbox.takeReading(now: saved)
        XCTAssertTrue((defaults.persistentDomain(forName: suite) ?? [:]).isEmpty, "nothing lingers after it is taken")
    }
}
