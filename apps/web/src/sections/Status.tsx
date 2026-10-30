import { SectionHead } from "../components/SectionHead";
import { STATUS_ITEMS, STATUS_STATE_LABELS } from "../content/site.ts";

export function Status() {
  return (
    <section className="section status" id="status" aria-labelledby="status-title">
      <div className="container status-grid">
        <SectionHead title="지금은 여기까지 만들었어요." titleId="status-title">
          <p>
            제주 버스에서 내릴 때를 알려주는 iPhone 앱을 만들고 있어요. 실제 이용 전 검증이 필요하며 출시일은 아직 정하지 않았어요.
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
