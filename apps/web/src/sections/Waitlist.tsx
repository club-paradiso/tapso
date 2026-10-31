export function Waitlist() {
  return (
    <section className="section waitlist" id="waitlist" aria-labelledby="waitlist-title">
      <div className="container waitlist-grid">
        <div className="waitlist-copy">
          <h2 id="waitlist-title"><span className="waitlist-campaign">와리지 말앙,<br />쉬멍 탑서.</span><span className="waitlist-mobile-title">출시를 준비하고 있어요.</span></h2>
          <p className="waitlist-translate">서두르지 말고, 쉬어 가며 타세요.</p>
          <p>아직 사전예약을 받고 있지 않아요. TestFlight 공개 일정은 정해지지 않았어요. 현재 개발 현황을 확인해 주세요.</p>
          <a className="btn btn-primary" href="#status">개발 현황 보기</a>
        </div>
      </div>
    </section>
  );
}
