import { SectionHead } from "../components/SectionHead";
import { LINKS, STATUS_ITEMS, STATUS_STATE_LABELS } from "../content/site.ts";

export function Status() {
  return (
    <section className="section status" id="status" aria-labelledby="status-title">
      <div className="container status-grid">
        <SectionHead index="08" eyebrow="개발 현황" title="지금 어디까지 왔나요." titleId="status-title">
          <p>
            탑서는 아직 출시 전이에요. 무엇이 끝났고 무엇이 남았는지 그대로 적어둘게요. 출시 날짜는
            정하지 않았어요.
          </p>
          <p className="fineprint">
            자세한 진행 기록은{" "}
            <a className="text-link" href={LINKS.github} rel="noopener">
              GitHub 저장소
            </a>
            에 공개돼 있어요.
          </p>
        </SectionHead>

        <ol className="timeline">
          {STATUS_ITEMS.map((item) => (
            <li key={item.title} className={`timeline-item state-${item.state}`}>
              <span className="timeline-node" aria-hidden="true" />
              <div className="timeline-body">
                <p className="timeline-top">
                  <b>{item.title}</b>
                  <span className={`state-pill tone-${item.state}`}>{STATUS_STATE_LABELS[item.state]}</span>
                </p>
                <p>{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
