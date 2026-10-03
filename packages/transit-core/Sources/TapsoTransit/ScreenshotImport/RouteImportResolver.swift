import Foundation

/// Checks what a screenshot claims against TAPSO's own route data and decides
/// how far to trust it. The transit data is the authority: a bus number alone
/// never makes a proposal, a stop must be found on the route, a direction must
/// be possible, and several surviving candidates are shown, never guessed between.
///
/// Rules, in order:
/// 1. A route variant is considered only if its number was read (exactly, or with
///    look-alike characters fixed: `44O`). A corrected number needs ordered stops to reach high confidence.
/// 2. Each stop line is matched to that variant's stops (`StopNameSimilarity`).
///    No matched stop, no proposal.
/// 3. Two or more matched stops must appear in the variant in the order the screenshot
///    lists them. A variant that runs the other way is rejected; the sibling
///    direction can still fit. One line out of order is tolerated, at a cost.
/// 4. One matched stop is a place to get off (a stop labelled `출발` is no use). It cannot
///    be a variant's first stop: nobody gets off before boarding.
/// 5. Two or more surviving candidates, or candidates on different bus numbers, are
///    ambiguous. Only a single survivor with ordered stops (or a strong,
///    uncorrected single stop), read with enough OCR confidence, is `confirmed`.
public struct RouteImportResolver: Sendable {
    /// A proposal scoring below this is not offered at all.
    public static let minimumScore = 50
    /// Another candidate within this many points of the best makes the answer ambiguous.
    public static let ambiguityMargin = 15
    /// Candidates further than this below the best are not listed.
    public static let listMargin = 30
    public static let maxChoices = 3
    /// Below this mean OCR confidence a result is never `confirmed`.
    public static let confidentOCR = 0.5
    /// Below this the text is too uncertain to try.
    public static let hopelessOCR = 0.2

    public let similarity: StopNameSimilarity

    public init(similarity: StopNameSimilarity = StopNameSimilarity()) {
        self.similarity = similarity
    }

    public func resolve(_ reading: ScreenshotReading, routes: [TransitRoute]) -> RouteImportResult {
        if reading.lineCount == 0 { return .notFound(.noTextFound) }
        if reading.ocrConfidence < Self.hopelessOCR { return .notFound(.lowQuality) }
        if reading.busNumbers.isEmpty { return .notFound(.notARouteScreenshot) }

        let numbers = Dictionary(reading.busNumbers.map { ($0.number, $0) }, uniquingKeysWith: { first, _ in first })
        let candidates = routes.filter { numbers[$0.number] != nil }
        if candidates.isEmpty { return .notFound(.noSupportedBus) }

        var proposals: [RouteImportProposal] = []
        for route in candidates {
            guard let number = numbers[route.number] else { continue }
            proposals.append(contentsOf: self.proposals(for: route, number: number, reading: reading))
        }
        let survivors = deduplicated(proposals)
            .filter { $0.score >= Self.minimumScore }
            .sorted(by: Self.ranksBefore)
        guard let top = survivors.first else { return .notFound(.noStopMatch) }

        let sameNumber = Set(survivors.map(\.route.number)).count == 1
        let contenders = survivors.filter { $0.score >= top.score - Self.ambiguityMargin }
        if sameNumber, contenders.count == 1, isConfirmable(top, ocr: reading.ocrConfidence) {
            return .confirmed(top)
        }
        let listed = survivors.filter { $0.score >= top.score - Self.listMargin }
        return .choose(Array(listed.prefix(Self.maxChoices)))
    }

    // MARK: Confidence

    private func isConfirmable(_ proposal: RouteImportProposal, ocr: Double) -> Bool {
        guard ocr >= Self.confidentOCR else { return false }
        switch proposal.evidence {
        case .orderedStops:
            return true
        case .destinationOnly:
            return !proposal.numberWasCorrected && proposal.weakestStopSimilarity >= StopNameSimilarity.strongThreshold
        case .partiallyOrderedStops:
            return false
        }
    }

    private static func ranksBefore(_ lhs: RouteImportProposal, _ rhs: RouteImportProposal) -> Bool {
        if lhs.score != rhs.score { return lhs.score > rhs.score }
        if lhs.route.id.rawValue != rhs.route.id.rawValue { return lhs.route.id.rawValue < rhs.route.id.rawValue }
        if lhs.destination.sequence != rhs.destination.sequence { return lhs.destination.sequence < rhs.destination.sequence }
        return (lhs.boarding?.sequence ?? -1) < (rhs.boarding?.sequence ?? -1)
    }

    private func deduplicated(_ proposals: [RouteImportProposal]) -> [RouteImportProposal] {
        var seen = Set<String>()
        return proposals.filter { proposal in
            let key = "\(proposal.route.id.rawValue)|\(proposal.boarding?.sequence ?? -1)|\(proposal.destination.sequence)"
            return seen.insert(key).inserted
        }
    }

    // MARK: One route variant

    private struct Option {
        let routeStop: RouteStop
        let similarity: Double
    }

    /// A visible stop line and every stop of the variant it could be.
    private struct Visible {
        let role: StopLineRole
        let options: [Option]
    }

    private func visibleStops(on route: TransitRoute, in reading: ScreenshotReading) -> [Visible] {
        var visible: [Visible] = []
        for line in reading.stopLines {
            let scored: [Option] = route.stops.compactMap { routeStop in
                similarity.match(line.text, to: routeStop.stop.name).map { Option(routeStop: routeStop, similarity: $0.similarity) }
            }
            guard let best = scored.map(\.similarity).max() else { continue }
            let options = scored.filter { $0.similarity >= best - 0.02 }
            // Two lines naming the same stop (a list entry and a map label) are one claim.
            let sequences = Set(options.map(\.routeStop.sequence))
            if visible.contains(where: { Set($0.options.map(\.routeStop.sequence)) == sequences }) { continue }
            visible.append(Visible(role: line.role, options: options))
        }
        return visible
    }

    private func proposals(for route: TransitRoute, number: BusNumberCandidate, reading: ScreenshotReading) -> [RouteImportProposal] {
        let visible = visibleStops(on: route, in: reading)
        guard !visible.isEmpty else { return [] }
        let base = number.wasCorrected ? 30 : 40
        let firstSequence = route.stops.first?.sequence

        if visible.count == 1 {
            let only = visible[0]
            guard only.role != .origin else { return [] }
            return only.options
                .filter { $0.routeStop.sequence != firstSequence }
                .map { option in
                    var score = base + Int((option.similarity * 10).rounded())
                    if only.role == .destination { score += 10 }
                    if endsAtTerminus(option, of: route) { score += 5 }
                    return RouteImportProposal(
                        route: route,
                        boarding: nil,
                        destination: option.routeStop,
                        evidence: .destinationOnly,
                        score: score,
                        numberWasCorrected: number.wasCorrected,
                        weakestStopSimilarity: option.similarity
                    )
                }
        }

        let forward = Self.longestChain(in: visible, ascending: true)
        let backward = Self.longestChain(in: visible, ascending: false)
        // A route that runs the other way, or that disagrees with more than one line, is not this screenshot's route.
        guard forward.count >= 2, forward.count >= backward.count, forward.count >= visible.count - 1 else { return [] }
        guard let first = forward.first, let last = forward.last else { return [] }

        let complete = forward.count == visible.count
        var score = base
        score += forward.prefix(5).map { Int(($0.option.similarity * 10).rounded()) }.reduce(0, +)
        score += complete ? 20 : -15
        if endsAtTerminus(last.option, of: route) { score += 5 }
        if !rolesAgree(visible: visible, chain: forward) { score -= 10 }

        return [RouteImportProposal(
            route: route,
            boarding: first.option.routeStop,
            destination: last.option.routeStop,
            evidence: complete ? .orderedStops(count: forward.count) : .partiallyOrderedStops(count: forward.count),
            score: score,
            numberWasCorrected: number.wasCorrected,
            weakestStopSimilarity: forward.map(\.option.similarity).min() ?? 0
        )]
    }

    private func endsAtTerminus(_ option: Option, of route: TransitRoute) -> Bool {
        similarity.match(route.destinationName, to: option.routeStop.stop.name).map { $0.similarity >= StopNameSimilarity.strongThreshold } ?? false
    }

    /// A line labelled `출발` should open the chain and one labelled `도착` should close it.
    private func rolesAgree(visible: [Visible], chain: [ChainLink]) -> Bool {
        let used = Set(chain.map(\.entry))
        for (index, entry) in visible.enumerated() where entry.role != .plain {
            guard used.contains(index) else { return false }
            if entry.role == .origin, chain.first?.entry != index { return false }
            if entry.role == .destination, chain.last?.entry != index { return false }
        }
        return true
    }

    // MARK: Order

    private struct ChainLink {
        let entry: Int
        let option: Option
    }

    private struct Step {
        var length: Int
        var similaritySum: Double
        var previous: (entry: Int, option: Int)?
    }

    /// The longest run of visible stops that the route passes through in the listed order
    /// (`ascending`) or in the opposite order. Ties go to the closer name matches.
    private static func longestChain(in visible: [Visible], ascending: Bool) -> [ChainLink] {
        var table: [[Step]] = []
        var best: (entry: Int, option: Int)?

        func isBetter(_ lhs: Step, than rhs: Step) -> Bool {
            lhs.length != rhs.length ? lhs.length > rhs.length : lhs.similaritySum > rhs.similaritySum
        }

        for (i, entry) in visible.enumerated() {
            var row: [Step] = []
            for option in entry.options {
                var step = Step(length: 1, similaritySum: option.similarity, previous: nil)
                for k in 0..<i {
                    for (l, prior) in visible[k].options.enumerated() {
                        let ordered = ascending
                            ? prior.routeStop.sequence < option.routeStop.sequence
                            : prior.routeStop.sequence > option.routeStop.sequence
                        guard ordered else { continue }
                        let extended = Step(
                            length: table[k][l].length + 1,
                            similaritySum: table[k][l].similaritySum + option.similarity,
                            previous: (k, l)
                        )
                        if isBetter(extended, than: step) { step = extended }
                    }
                }
                row.append(step)
            }
            table.append(row)
            for (j, step) in row.enumerated() {
                if let current = best {
                    if isBetter(step, than: table[current.entry][current.option]) { best = (i, j) }
                } else {
                    best = (i, j)
                }
            }
        }

        var chain: [ChainLink] = []
        var cursor = best
        while let at = cursor {
            chain.append(ChainLink(entry: at.entry, option: visible[at.entry].options[at.option]))
            cursor = table[at.entry][at.option].previous
        }
        return chain.reversed()
    }
}
