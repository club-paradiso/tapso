import { ResponsiveDetails } from "../components/ResponsiveDetails";
import { SectionHead } from "../components/SectionHead";
import { FAQ_ITEMS } from "../content/site.ts";

const PRIORITY_QUESTIONS = new Set([0, 3, 8]);

function Question({ item }: { item: (typeof FAQ_ITEMS)[number] }) {
  return <details><summary><span>{item.q}</span><span className="faq-toggle" aria-hidden="true" /></summary><p>{item.a}</p></details>;
}

/** Native disclosure widgets: keyboard, screen reader and no-JS support for free. */
export function Faq() {
  return (
    <section className="section faq" id="faq" aria-labelledby="faq-title">
      <div className="container faq-grid">
        <SectionHead title="궁금한 점" titleId="faq-title">
          <p>버스를 탈 때 필요한 정보와 출시 준비 상황을 모았어요.</p>
        </SectionHead>
        <div className="faq-list">
          {FAQ_ITEMS.filter((_, index) => PRIORITY_QUESTIONS.has(index)).map((item) => <Question key={item.q} item={item} />)}
          <ResponsiveDetails summary="질문 더 보기">
            {FAQ_ITEMS.filter((_, index) => !PRIORITY_QUESTIONS.has(index)).map((item) => <Question key={item.q} item={item} />)}
          </ResponsiveDetails>
        </div>
      </div>
    </section>
  );
}
