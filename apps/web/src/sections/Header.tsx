import { ThemeToggle } from "../design/Theme";
import { NAV_ITEMS } from "../content/site.ts";
import { BrandMark } from "../components/BrandMark";
import type { View } from "../components/ResponsiveDetails";
import { useStory } from "../story/storyStore.ts";

/**
 * Brand, top tabs and the support shortcut. The tabs are ordinary links: each
 * opens one view of the page, and the current one is marked for assistive
 * technology with aria-current. On phones the tabs take their own row so they
 * stay visible instead of hiding behind a menu.
 */
export function Header({ view }: { view: View }) {
  const overFilm = useStory((s) => s.heroInView) && view === "home";
  return (
    <header className={`site-header${overFilm ? " is-over-film" : ""}`}>
      <a className="skip-link" href="#main">본문으로 건너뛰기</a>
      <div className="container site-header-inner">
        <a className="brand" href="#top" aria-label="TAPSO, 홈으로">
          <BrandMark />
          <span className="brand-word" data-wordmark="TAPSO" aria-hidden="true">TAPS<span className="brand-word-o">O</span></span>
        </a>
        <nav className="site-nav" aria-label="페이지 탭"><ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <a href={item.href} aria-current={item.view === view ? "page" : undefined}>{item.label}</a>
            </li>
          ))}
        </ul></nav>
        <div className="header-theme"><ThemeToggle /></div>
        <a className="btn btn-primary btn-sm header-cta" href="#support">후원하기</a>
      </div>
    </header>
  );
}
