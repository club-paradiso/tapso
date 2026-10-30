export function Waitlist() {
  return (
    <section className="section waitlist" id="waitlist" aria-labelledby="waitlist-title">
      <div className="container waitlist-grid">
        <div className="waitlist-copy">
          <h2 id="waitlist-title">혼저 탑서.<br />아직 사전예약을 받고 있지 않아요.</h2>
          <p className="waitlist-translate">‘혼저 탑서’는 제주어로 ‘어서 타세요’예요.</p>
          <p>TestFlight 공개 일정은 정해지지 않았어요. 현재 개발 현황을 확인해 주세요.</p>
          <a className="btn btn-primary" href="#status">개발 현황 보기</a>
        </div>
      </div>
    </section>
  );
}
