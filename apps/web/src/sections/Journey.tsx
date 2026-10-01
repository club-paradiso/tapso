import { useRef, type ReactNode } from "react";
import {
  BeatDevice,
  BeatPicture,
  BusScene,
  GlanceChart,
  TrustTable,
  VariantPicker,
  pictureLabel,
  stageCaption,
  useBeatVariant,
} from "../components/JourneyParts";
import { PreviewTag } from "../components/RideParts";
import { presentMoment } from "../demo/rideMoments.ts";
import { BEATS, CHAPTERS, beatsOf, resolveBeat, type Beat, type Chapter } from "../story/beats.ts";
import { CHAPTER_COPY, STEP_COPY, TRUST_NOTES } from "../story/journeyCopy.ts";
import { useStory, useStoryTracking } from "../story/storyStore.ts";

const DARK_CHAPTERS: ReadonlySet<Chapter> = new Set(["ride", "trust", "arrive"]);

function StepExtras({ beat }: { beat: Beat }) {
  const variant = useBeatVariant(beat);
  switch (beat.id) {
    case "sameBus":
      return <BusScene />;
    case "pocket":
      return <GlanceChart />;
    case "island":
      return <VariantPicker beat={beat} label="다이나믹 아일랜드 모양 고르기" />;
    case "trust":
      return (
        <>
          <VariantPicker beat={beat} label="상황 고르기" />
          <p className="step-variant-note" aria-live="polite">
            {TRUST_NOTES[variant ?? ""] ?? ""}
          </p>
          <TrustTable beat={beat} />
        </>
      );
    default:
      return null;
  }
}

function Step({ beat, index, active }: { beat: Beat; index: number; active: number }) {
  const copy = STEP_COPY[beat.id];
  const variant = useBeatVariant(beat);
  const { stage, activity } = resolveBeat(beat, variant);
  // Before the ride there is no moment colour: the route's own mint is used.
  const role = activity ? ` role-${presentMoment(activity.moment).colorRole}` : "";
  const state = index === active ? " is-active" : index < active ? " is-past" : "";
  return (
    <article className={`step${role}${state}`} data-beat={beat.id} aria-labelledby={`step-${beat.id}`}>
      <span className="step-stop" aria-hidden="true" />
      <p className="step-label">{copy.label}</p>
      <h3 id={`step-${beat.id}`}>{copy.title}</h3>
      <p className="step-body">{copy.body}</p>
      <StepExtras beat={beat} />
      {copy.note ? <p className="step-note">{copy.note}</p> : null}
      <p className="visually-hidden">그림: {pictureLabel(stage, activity)}</p>
      <div className="step-visual" aria-hidden="true">
        <BeatPicture stage={stage} activity={activity} />
        <span className="step-visual-caption">{stageCaption(stage)}</span>
      </div>
    </article>
  );
}

function ChapterBlock({ chapter, active, children }: { chapter: (typeof CHAPTERS)[number]; active: number; children?: ReactNode }) {
  const copy = CHAPTER_COPY[chapter.id];
  return (
    <section
      className={`chapter chapter-${chapter.id}${DARK_CHAPTERS.has(chapter.id) ? " on-dark" : ""}`}
      id={chapter.id}
      aria-labelledby={`chapter-${chapter.id}`}
    >
      <header className="chapter-head">
        <p className="eyebrow">
          <span className="eyebrow-index">{chapter.index}</span>
          <span className="eyebrow-rail" aria-hidden="true" />
          {chapter.eyebrow}
        </p>
        <h2 id={`chapter-${chapter.id}`}>{copy.title}</h2>
        <p className="chapter-lede">{copy.lede}</p>
      </header>
      {beatsOf(chapter.id).map((beat) => (
        <Step key={beat.id} beat={beat} index={BEATS.indexOf(beat)} active={active} />
      ))}
      {children}
    </section>
  );
}

/** The sticky phone: the same beat the visitor is reading, drawn on one device. */
function Stage() {
  const position = useStory((s) => s.position);
  const variants = useStory((s) => s.variants);
  const beat = BEATS.find((b) => b.id === position) ?? (position === "after" ? BEATS[BEATS.length - 1]! : BEATS[0]!);
  const { stage, activity } = resolveBeat(beat, variants[beat.id]);
  const role = activity ? ` role-${presentMoment(activity.moment).colorRole}` : "";
  return (
    <div className={`stage${role} stage-${stage.kind}`}>
      <span className="stage-glow" />
      <div className="stage-device" key={stage.kind}>
        <BeatDevice stage={stage} activity={activity} />
      </div>
      <p className="stage-caption">{stageCaption(stage)}</p>
      <PreviewTag />
    </div>
  );
}

/**
 * 01–05: one SYNTHETIC ride from choosing where to get off to getting off.
 *
 * The steps are ordinary content in reading order; scrolling only tells the
 * sticky phone and the persistent island which step is being read. Nothing
 * is pinned, hijacked or hidden until scrolled to.
 */
export function Journey() {
  const ref = useRef<HTMLDivElement>(null);
  useStoryTracking(ref);
  const position = useStory((s) => s.position);
  const active = position === "before" ? -1 : position === "after" ? BEATS.length : BEATS.findIndex((b) => b.id === position);

  return (
    <div className="journey" id="how" ref={ref}>
      <div className="container journey-grid">
        <div className="journey-flow" style={{ ["--journey-progress" as string]: Math.max(0, active) / (BEATS.length - 1) }}>
          {CHAPTERS.map((chapter) => (
            <ChapterBlock key={chapter.id} chapter={chapter} active={active} />
          ))}
        </div>
        <aside className="journey-stage" aria-hidden="true">
          <Stage />
        </aside>
      </div>
    </div>
  );
}
