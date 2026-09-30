import type { ReactNode } from "react";

/** Section opener: a numbered eyebrow on the journey rail motif, the heading, a lede. */
export function SectionHead({
  index,
  eyebrow,
  title,
  titleId,
  children,
  align = "start",
}: {
  index: string;
  eyebrow: string;
  title: ReactNode;
  titleId: string;
  children?: ReactNode;
  align?: "start" | "center";
}) {
  return (
    <header className={`section-head align-${align}`}>
      <p className="eyebrow">
        <span className="eyebrow-index">{index}</span>
        <span className="eyebrow-rail" aria-hidden="true" />
        {eyebrow}
      </p>
      <h2 id={titleId}>{title}</h2>
      {children ? <div className="section-lede">{children}</div> : null}
    </header>
  );
}
