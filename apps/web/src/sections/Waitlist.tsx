export function Waitlist() {
  return (
    <section className="section waitlist" id="waitlist" aria-labelledby="waitlist-title">
      <div className="container waitlist-grid">
        <div className="waitlist-copy">
          <h2 id="waitlist-title"><span className="waitlist-campaign">와리지 말앙,<br />쉬멍 탑서.</span><span className="waitlist-mobile-title">출시를 준비하고 있어요.</span></h2>
          <p className="waitlist-translate">서두르지 말고, 쉬어 가며 타세요.</p>
          <p>실제 iPhone 테스트와 배포를 준비하고 있어요. TestFlight 공개 일정은 아직 정해지지 않았어요.</p>
          <a className="btn btn-primary" href="#status">개발 현황 보기</a>
        </div>
      </div>
    </section>
  );
}
