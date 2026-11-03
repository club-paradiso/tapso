import { ResponsiveDetails } from "../components/ResponsiveDetails";
import { SectionHead } from "../components/SectionHead";
import { STATUS_GROUPS, STATUS_ITEMS, STATUS_LEVEL_LABELS } from "../content/site.ts";

export function Status() {
  return (
    <section className="section status" id="status" aria-labelledby="status-title">
      <div className="container status-grid">
        <SectionHead title="우리, 곧 만나요." titleId="status-title" />
        <ResponsiveDetails summary="지금까지 만든 기능 보기">
          <p className="status-note">아직 출시 전이며, 출시일은 정해지지 않았어요. ‘구현됨’은 코드를 만들었다는 뜻으로, 실제 iPhone에서의 동작 확인은 남아 있어요.</p>
            <div className="status-groups">
              {STATUS_GROUPS.map((group) => (
                <section key={group.id} className="status-group" aria-labelledby={`status-${group.id}`}>
                  <h3 id={`status-${group.id}`}>{group.title}</h3>
                  <p className="status-group-lede">{group.lede}</p>
                  <ol className="timeline">
                    {STATUS_ITEMS.filter((item) => item.group === group.id).map((item) => (
                      <li key={item.id} className={`timeline-item level-${item.level}`}>
                        <span className="timeline-node" aria-hidden="true" />
                        <div className="timeline-body">
                          <p className="timeline-top">
                            <b>{item.title}</b>
                            <span className={`state-pill level-pill-${item.level}`}>{STATUS_LEVEL_LABELS[item.level]}</span>
                          </p>
                          <p>{item.body}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
        </ResponsiveDetails>
      </div>
    </section>
  );
}
