import SwiftUI
import TapsoTransit

// The "돌아갈 시간" Live Activity (`TapsoReturnAttributes`) as plain views, so the widget
// extension and the app's snapshot tests render the same code.
// Figma: `09 Return / Rescue` › `V3 / 27 Return countdown` (`199:3046`); components
// `ReturnCountdown / Lock Screen V3` and `ReturnCountdown / Island V3` on `02G iOS Product V3`.
//
// Colours are fixed values that read on basalt in light and dark mode alike: amber while
// there is time, tangerine once the time to be at the stop has passed.

enum ReturnSurfacePalette {
    static let background = TapsoColor.basalt
    static let primary = TapsoColor.textOnDarkSurface
    static let secondary = TapsoColor.textOnDarkSurface.opacity(0.7)

    static func accent(isLate: Bool) -> Color {
        isLate ? TapsoColor.tangerine : TapsoColor.journeyPrepare
    }
}

enum ReturnText {
    static func direction(_ attributes: TapsoReturnAttributes) -> String {
        String(format: RideText.string("returnTrip.direction"), attributes.startStopName, attributes.endStopName)
    }

    static func headline(_ attributes: TapsoReturnAttributes, isLate: Bool) -> String {
        isLate
            ? RideText.string("returnTrip.activity.late.title")
            : String(format: RideText.string("returnTrip.level.leaveBy"), attributes.beAtStopByText)
    }

    static func detail(_ attributes: TapsoReturnAttributes, isLate: Bool) -> String {
        isLate
            ? String(format: RideText.string("returnTrip.activity.late.body"), attributes.lastDeparture)
            : String(format: RideText.string("returnTrip.last"), attributes.lastDeparture)
    }

    static func accessibility(_ attributes: TapsoReturnAttributes, isLate: Bool) -> String {
        [
            String(format: RideText.string("a11y.route"), attributes.routeNumber),
            direction(attributes),
            headline(attributes, isLate: isLate),
            detail(attributes, isLate: isLate),
        ].joined(separator: ". ")
    }
}

/// The time left until the rider should be at the stop, run by the system. Past it, a word, never a negative time.
struct ReturnCountdown: View {
    let state: TapsoReturnAttributes.ContentState
    let isLate: Bool
    var font: Font = TapsoType.numeral(30)
    /// Widgets cannot measure a running timer, so its width is fixed; "1:23:00" fits on one line.
    var width: CGFloat = 124

    var body: some View {
        if isLate {
            // A short word hugs its text, leaving the headline room to break between words.
            Text("returnTrip.activity.late.short")
                .font(font)
                .foregroundStyle(ReturnSurfacePalette.accent(isLate: true))
                .lineLimit(1)
                .fixedSize()
        } else {
            Text(timerInterval: state.countdown, countsDown: true)
                .monospacedDigit()
                .font(font)
                .foregroundStyle(ReturnSurfacePalette.accent(isLate: false))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .multilineTextAlignment(.trailing)
                .frame(width: width, alignment: .trailing)
        }
    }
}

struct ReturnLockScreenView: View {
    let attributes: TapsoReturnAttributes
    let state: TapsoReturnAttributes.ContentState
    /// ActivityKit's `context.isStale`. The stale date is `beAtStopBy`, so stale means late.
    var isStale = false
    /// The widget draws its background with `activityBackgroundTint`; previews and tests draw it here.
    var drawsBackground = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                RouteBadge(number: attributes.routeNumber, role: .journeyPrepare)
                Text(verbatim: ReturnText.direction(attributes))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ReturnSurfacePalette.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 4)
                Image(systemName: "moon.stars.fill")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(ReturnSurfacePalette.accent(isLate: isStale))
                    .accessibilityHidden(true)
            }
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: ReturnText.headline(attributes, isLate: isStale))
                        .font(.title3.weight(.heavy))
                        .foregroundStyle(isStale ? ReturnSurfacePalette.accent(isLate: true) : ReturnSurfacePalette.primary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                    Text(verbatim: ReturnText.detail(attributes, isLate: isStale))
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(ReturnSurfacePalette.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 4)
                ReturnCountdown(state: state, isLate: isStale)
            }
        }
        .padding(16)
        .background {
            if drawsBackground {
                ReturnSurfacePalette.background
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ReturnText.accessibility(attributes, isLate: isStale)))
    }
}

struct ReturnIslandCompactLeading: View {
    let attributes: TapsoReturnAttributes
    var isStale = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "moon.stars.fill")
                .font(.system(size: 11, weight: .bold))
            Text(verbatim: attributes.routeNumber)
                .font(.caption.weight(.heavy))
                .monospacedDigit()
        }
        .foregroundStyle(ReturnSurfacePalette.accent(isLate: isStale))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(format: RideText.string("a11y.route"), attributes.routeNumber)))
    }
}

struct ReturnIslandCompactTrailing: View {
    let state: TapsoReturnAttributes.ContentState
    var isStale = false

    var body: some View {
        ReturnCountdown(state: state, isLate: isStale, font: .system(.caption, design: .rounded, weight: .heavy), width: 52)
    }
}

struct ReturnIslandMinimal: View {
    var isStale = false

    var body: some View {
        Image(systemName: isStale ? "exclamationmark" : "moon.stars.fill")
            .font(.caption.weight(.black))
            .foregroundStyle(ReturnSurfacePalette.accent(isLate: isStale))
            .accessibilityLabel(Text(LocalizedStringKey(isStale ? "returnTrip.activity.late.title" : "returnTrip.title")))
    }
}

struct ReturnIslandExpandedLeading: View {
    let attributes: TapsoReturnAttributes
    var isStale = false

    var body: some View {
        RouteBadge(number: attributes.routeNumber, role: .journeyPrepare, compact: true)
            .padding(.leading, 4)
    }
}

struct ReturnIslandExpandedTrailing: View {
    let state: TapsoReturnAttributes.ContentState
    var isStale = false

    var body: some View {
        ReturnCountdown(state: state, isLate: isStale, font: TapsoType.numeral(24), width: 84)
            .padding(.trailing, 4)
    }
}

struct ReturnIslandExpandedBottom: View {
    let attributes: TapsoReturnAttributes
    var isStale = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: ReturnText.headline(attributes, isLate: isStale))
                .font(.headline.weight(.heavy))
                .foregroundStyle(isStale ? ReturnSurfacePalette.accent(isLate: true) : ReturnSurfacePalette.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(verbatim: ReturnText.direction(attributes) + " · " + ReturnText.detail(attributes, isLate: isStale))
                .font(.caption)
                .foregroundStyle(ReturnSurfacePalette.secondary)
                .lineLimit(2)
        }
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ReturnText.accessibility(attributes, isLate: isStale)))
    }
}
