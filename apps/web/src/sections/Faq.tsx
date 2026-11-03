import { ResponsiveDetails } from "../components/ResponsiveDetails";
import { SectionHead } from "../components/SectionHead";
import { FAQ_ITEMS } from "../content/site.ts";

function Question({ item }: { item: (typeof FAQ_ITEMS)[number] }) {
  return <details><summary><span>{item.q}</span><span className="faq-toggle" aria-hidden="true" /></summary><p>{item.a}</p></details>;
}

/** Native disclosure widgets: keyboard, screen reader and no-JS support for free. */
export function Faq() {
  return (
    <section className="section faq" id="faq" aria-labelledby="faq-title">
      <div className="container faq-grid">
        <SectionHead title="FAQ" titleId="faq-title" />
        <ResponsiveDetails summary="자주 묻는 질문 보기">
        <div className="faq-list">
          {FAQ_ITEMS.map((item) => <Question key={item.q} item={item} />)}
        </div>
        </ResponsiveDetails>
      </div>
    </section>
  );
}
