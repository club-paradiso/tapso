import { ThemeToggle } from "../design/Theme";
import { NAV_ITEMS } from "../content/site.ts";
import { BrandMark } from "../components/BrandMark";
import { useStory } from "../story/storyStore.ts";

export function Header() {
  // Over the hero film the header drops its panel and turns white.
  const overFilm = useStory((s) => s.heroInView);
  return (
    <header className={`site-header${overFilm ? " is-over-film" : ""}`}>
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <div className="container site-header-inner">
        <a className="brand" href="#top" aria-label="TAPSO, 맨 위로">
          <BrandMark />
          <span className="brand-word" data-wordmark="TAPSO" aria-hidden="true">
            TAPS<span className="brand-word-o">O</span>
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
        <ThemeToggle />
        <a className="btn btn-primary btn-sm header-cta" href="#status">
          개발 현황
        </a>
      </div>
    </header>
  );
}
