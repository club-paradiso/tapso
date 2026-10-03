import { NAV_ITEMS } from "../content/site.ts";
import { BrandMark } from "../components/BrandMark";
import { useIslandShowing } from "../components/IslandDock";

export function Header() {
  // Between 900 and 1240 px the island needs the middle of the header; the nav steps aside.
  const island = useIslandShowing();
  return (
    <header className={`site-header${island ? " has-island" : ""}`}>
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <div className="container site-header-inner">
        <a className="brand" href="#top" aria-label="TAPSO 탑서, 맨 위로">
          <BrandMark />
          <span className="brand-word" aria-hidden="true">
            TAPSŌ <span>탑서</span>
          </span>
        </a>
        <nav className="site-nav" aria-label="페이지 안내">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <a className="btn btn-primary btn-sm header-cta" href="#waitlist">
          <span className="only-wide">TestFlight </span>사전예약
        </a>
      </div>
    </header>
  );
}
