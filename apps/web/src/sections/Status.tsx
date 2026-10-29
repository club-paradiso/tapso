import { SectionHead } from "../components/SectionHead";
import { STATUS_ITEMS, STATUS_STATE_LABELS } from "../content/site.ts";

export function Status() {
  return (
    <section className="section status" id="status" aria-labelledby="status-title">
      <div className="container status-grid">
        <SectionHead title="지금은 여기까지 만들었어요." titleId="status-title">
          <p>
            아직 출시 전입니다. 끝난 것, 만드는 중인 것, 아직 남은 일을 나눠서 적어뒀어요. 출시일은 아직 정하지 않았습니다.
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
