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
        <SectionHead title="FAQ" titleId="faq-title">
          <p>질문을 누르면 답이 펼쳐져요.</p>
        </SectionHead>
        <div className="faq-list">
          {FAQ_ITEMS.map((item) => <Question key={item.q} item={item} />)}
        </div>
      </div>
    </section>
  );
}
