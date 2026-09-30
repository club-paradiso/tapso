import { SectionHead } from "../components/SectionHead";
import { FAQ_ITEMS } from "../content/site.ts";

/** Native disclosure widgets: keyboard, screen reader and no-JS support for free. */
export function Faq() {
  return (
    <section className="section faq" id="faq" aria-labelledby="faq-title">
      <div className="container faq-grid">
        <SectionHead index="11" eyebrow="자주 묻는 질문" title="궁금한 점" titleId="faq-title">
          <p>여기에 없는 질문은 GitHub 이슈로 남겨주세요.</p>
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
