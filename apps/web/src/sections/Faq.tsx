import { SectionHead } from "../components/SectionHead";
import { FAQ_ITEMS } from "../content/site.ts";

/** Native disclosure widgets: keyboard, screen reader and no-JS support for free. */
export function Faq() {
  return (
    <section className="section faq" id="faq" aria-labelledby="faq-title">
      <div className="container faq-grid">
        <SectionHead title="궁금한 점" titleId="faq-title">
          <p>버스를 탈 때 필요한 정보와 출시 준비 상황을 모았어요.</p>
        </SectionHead>
        <div className="faq-list">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q}>
              <summary>
                <span>{item.q}</span>
                <span className="faq-toggle" aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
