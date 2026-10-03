import SwiftUI
import TapsoTransit

// Jeju's official timetables (`GET /v1/timetables`): dated, never live. They
// complement the live ride and never block it. The card says only what the
// server's view supports (`TimetableSummary`): today's first and last bus when
// a table's own day label covers today, the published times otherwise, and
// nothing when the official file is missing or contradicts itself. The as-of
// date is always on screen. Figma: no Figma component yet; drawn inside the screens.

struct TimetableCard: View {
    let routeNumber: String
    let load: TimetableLoad?
    let onLoad: () -> Void
    let onShowAll: (TransitAPITimetable) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TapsoSpace.xs) {
            switch load {
            case .none, .loading?:
                HStack(spacing: TapsoSpace.xs) {
                    ProgressView()
                    Text("route.timetable.loading")
                        .font(.footnote)
                        .foregroundStyle(TapsoColor.textSecondary)
                }
            case .failed?:
                HStack(spacing: TapsoSpace.xs) {
                    Text("route.timetable.failed")
                        .font(.footnote)
                        .foregroundStyle(TapsoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Button("common.retry", action: onLoad)
                        .font(.footnote.weight(.semibold))
                }
            case let .loaded(view)?:
                loaded(view, TimetableSummary.make(view))
            }
        }
        .padding(TapsoSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
        .accessibilityElement(children: .contain)
        .task(id: routeNumber) { if load == nil { onLoad() } }
    }

    @ViewBuilder
    private func loaded(_ view: TransitAPITimetable, _ summary: TimetableSummary) -> some View {
        Label(title(summary), systemImage: "calendar")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(TapsoColor.textPrimary)
        if summary.kind == .today, let holiday = summary.holidayName {
            Text(String(format: RideText.string("route.timetable.holiday"), holiday))
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
        }
        ForEach(Array(summary.lines.enumerated()), id: \.offset) { _, line in
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: TapsoSpace.xs) {
                    Text(verbatim: line.direction)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(TapsoColor.textPrimary)
                        .lineLimit(2)
                    if let label = line.dayLabel {
                        Text(verbatim: label)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(TapsoColor.textSecondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(TapsoColor.backgroundPrimary, in: Capsule())
                    }
                }
                Text(Self.firstLast(line))
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(TapsoColor.textSecondary)
                if line.hasLaterConditional {
                    Text("route.timetable.laterConditional")
                        .font(.caption)
                        .foregroundStyle(TapsoColor.textTertiary)
                }
            }
            .accessibilityElement(children: .combine)
        }
        Text(String(format: RideText.string(summary.isStale ? "route.timetable.stale" : "route.timetable.asOf"), summary.asOf))
            .font(.caption)
            .foregroundStyle(summary.isStale ? TapsoColor.journeyDegraded : TapsoColor.textTertiary)
            .fixedSize(horizontal: false, vertical: true)
        if view.services.contains(where: { $0.status == "ok" && !$0.trips.isEmpty }) {
            Button("route.timetable.showAll") { onShowAll(view) }
                .font(.footnote.weight(.semibold))
                .accessibilityIdentifier("timetable-show-all")
        }
    }

    private func title(_ summary: TimetableSummary) -> LocalizedStringKey {
        switch summary.kind {
        case .today: "route.timetable.today"
        case .undated: "route.timetable.undated"
        case .otherDays: "route.timetable.otherDays"
        case .withheld: "route.timetable.withheld"
        case .unavailable: "route.timetable.unavailable"
        }
    }

    static func firstLast(_ line: TimetableSummary.Line) -> String {
        let first = line.first.map { clock($0.time) + " " + String(format: RideText.string("route.timetable.from"), $0.from) } ?? "—"
        let last = line.last.map { clock($0.time) + " " + String(format: RideText.string("route.timetable.from"), $0.from) } ?? "—"
        return String(format: RideText.string("route.timetable.firstLast"), first, last)
    }

    static func clock(_ time: String) -> String {
        let shown = TimetableClock.display(time)
        return shown.nextDay ? String(format: RideText.string("route.timetable.nextDay"), shown.text) : shown.text
    }
}

/// "공식 시간표 보기": the published times at one timepoint, for each table. Between
/// timepoints the table says nothing, and neither does TAPSO.
struct TimetableSheet: View {
    let view: TransitAPITimetable
    @State private var selection: [String: Int] = [:]
    @Environment(\.dismiss) private var dismiss

    private var services: [TransitAPITimetable.Service] {
        view.services.filter { $0.status == "ok" && !$0.trips.isEmpty }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: TapsoSpace.lg) {
                    Text(String(format: RideText.string("route.timetable.sheet.source"), view.asOf))
                        .font(.footnote)
                        .foregroundStyle(TapsoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(Array(services.enumerated()), id: \.offset) { position, service in
                        serviceSection(service, key: "\(position)")
                    }
                }
                .padding(.horizontal, TapsoSpace.gutter)
                .padding(.vertical, TapsoSpace.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(TapsoColor.backgroundPrimary)
            .navigationTitle(Text(String(format: RideText.string("route.timetable.sheet.title"), view.routeNo)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("common.done") { dismiss() }
                }
            }
        }
    }

    private func serviceSection(_ service: TransitAPITimetable.Service, key: String) -> some View {
        let column = min(selection[key] ?? 0, max(0, service.timepoints.count - 1))
        let times = service.trips.compactMap { trip -> (String, Bool)? in
            guard column < trip.times.count, let time = trip.times[column] else { return nil }
            return (time, !(trip.conditions ?? []).isEmpty)
        }
        return VStack(alignment: .leading, spacing: TapsoSpace.sm) {
            Text(verbatim: service.direction)
                .font(.headline)
                .foregroundStyle(TapsoColor.textPrimary)
            Text(verbatim: dayText(service))
                .font(.footnote)
                .foregroundStyle(TapsoColor.textSecondary)
            Picker(selection: Binding(get: { column }, set: { selection[key] = $0 })) {
                ForEach(Array(service.timepoints.enumerated()), id: \.offset) { index, name in
                    Text(verbatim: label(name, index: index, in: service.timepoints)).tag(index)
                }
            } label: {
                Text("route.timetable.sheet.timepoint")
            }
            .pickerStyle(.menu)
            if times.isEmpty {
                Text("route.timetable.sheet.none")
                    .font(.footnote)
                    .foregroundStyle(TapsoColor.textSecondary)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: TapsoSpace.xs), count: 4), alignment: .leading, spacing: TapsoSpace.xs) {
                    ForEach(Array(times.enumerated()), id: \.offset) { _, entry in
                        Text(verbatim: TimetableCard.clock(entry.0) + (entry.1 ? " *" : ""))
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(entry.1 ? TapsoColor.textTertiary : TapsoColor.textPrimary)
                    }
                }
            }
            if service.hasConditionalTrips {
                Text("route.timetable.sheet.conditional")
                    .font(.caption)
                    .foregroundStyle(TapsoColor.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(TapsoSpace.md)
        .background(TapsoColor.backgroundSecondary, in: RoundedRectangle(cornerRadius: TapsoRadius.md, style: .continuous))
    }

    private func dayText(_ service: TransitAPITimetable.Service) -> String {
        var parts: [String] = [service.dayLabel ?? RideText.string("route.timetable.sheet.noDay")]
        if let from = service.effectiveFrom {
            parts.append(String(format: RideText.string("route.timetable.sheet.effective"), from))
        }
        if let labels = service.serviceLabels, !labels.isEmpty {
            parts.append(labels.joined(separator: ", "))
        }
        return parts.joined(separator: " · ")
    }

    /// A circular route names a timepoint twice: the second is told apart by its order.
    private func label(_ name: String, index: Int, in names: [String]) -> String {
        let occurrence = names[...index].filter { $0 == name }.count
        return names.filter { $0 == name }.count > 1 ? "\(name) (\(occurrence))" : name
    }
}
