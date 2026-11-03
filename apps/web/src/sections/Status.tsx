import { SectionHead } from "../components/SectionHead";
import { STATUS_GROUPS, STATUS_ITEMS, STATUS_LEVEL_LABELS, type StatusLevel } from "../content/site.ts";

export function Status() {
  const levels: StatusLevel[] = ["built", "realdata", "verifying", "blocked", "device"];
  return (
    <section className="section status" id="status" aria-labelledby="status-title">
      <div className="container status-grid">
        <div>
          <p className="view-eyebrow">개발 현황</p>
          <SectionHead title="우리, 곧 만나요." titleId="status-title">
            <p>내릴 곳 검색부터 내릴 때 안내까지, 지금 어디까지 만들었고 무엇이 남았는지 그대로 적었어요.</p>
            <p className="status-note">아직 출시 전이고, 출시일은 정해지지 않았어요. ‘구현됨’은 코드를 만들었다는 뜻이에요. 실제 iPhone에서의 동작 확인은 남아 있어요.</p>
          </SectionHead>
          <dl className="status-counts" aria-label="개발 단계별 항목 수">{levels.map((level) => {
            const count = STATUS_ITEMS.filter((item) => item.level === level).length;
            return count > 0 ? <div key={level} className={`level-${level}`}><dt>{STATUS_LEVEL_LABELS[level]}</dt><dd>{count}<span>개</span></dd></div> : null;
          })}</dl>
        </div>
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
      </div>
    </section>
  );
}
