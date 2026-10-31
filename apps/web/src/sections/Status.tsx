import { ResponsiveDetails } from "../components/ResponsiveDetails";
import { SectionHead } from "../components/SectionHead";
import { STATUS_GROUPS, STATUS_ITEMS, STATUS_LEVEL_LABELS, type StatusLevel } from "../content/site.ts";

export function Status() {
  const levels: StatusLevel[] = ["built", "realdata", "verifying", "blocked", "device"];
  return (
    <section className="section status" id="status" aria-labelledby="status-title">
      <div className="container status-grid">
        <SectionHead title="TAPSO는 지금 이렇게 만들어지고 있어요" titleId="status-title">
          <p>
            목적지 검색부터 하차 안내까지, TAPSO의 핵심 기능을 만들고 검증하고 있어요. 지금 구현된 기능과 출시 전까지 남은 과정을 확인해보세요.
          </p>
          <p className="status-note">아직 출시 전이고 출시일은 정해지지 않았어요. ‘구현됨’은 실제 iPhone 확인 전이라는 뜻이에요.</p>
        </SectionHead>

        <div className="status-overview">
          <dl className="status-counts" aria-label="개발 단계별 항목 수">{levels.map((level) => {
            const count = STATUS_ITEMS.filter((item) => item.level === level).length;
            return count > 0 ? <div key={level} className={`level-${level}`}><dt>{STATUS_LEVEL_LABELS[level]}</dt><dd>{count}<span>개</span></dd></div> : null;
          })}</dl>
          <div className="mobile-status-list" aria-label="기능별 개발 현황">
            {STATUS_GROUPS.map((group) => (
              <section key={group.id} aria-labelledby={`mobile-status-${group.id}`}>
                <h3 id={`mobile-status-${group.id}`}>{group.title}</h3>
                {STATUS_ITEMS.filter((item) => item.group === group.id).map((item) => (
                  <details key={item.id} className={`mobile-status-item level-${item.level}`}>
                    <summary><span>{item.title}</span><span className={`state-pill level-pill-${item.level}`}>{STATUS_LEVEL_LABELS[item.level]}</span><span className="disclosure-mark" aria-hidden="true" /></summary>
                    <p>{item.body}</p>
                  </details>
                ))}
              </section>
            ))}
            <p className="fineprint">기능을 누르면 확인한 범위와 남은 검증을 볼 수 있어요.</p>
          </div>
          <ResponsiveDetails summary="전체 개발 현황 보기">
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
      </div>
    </section>
  );
}
