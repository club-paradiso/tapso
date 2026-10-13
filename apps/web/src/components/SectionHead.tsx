import type { ReactNode } from "react";

/** Section opener: a numbered eyebrow on the journey rail motif, the heading, a lede. */
export function SectionHead({
  title,
  titleId,
  children,
  align = "start",
}: {
  title: ReactNode;
  titleId: string;
  children?: ReactNode;
  align?: "start" | "center";
}) {
  return (
    <header className={`section-head align-${align}`}>
      <h2 id={titleId}>{title}</h2>
      {children ? <div className="section-lede">{children}</div> : null}
    </header>
  );
}
