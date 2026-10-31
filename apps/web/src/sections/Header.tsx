import { useEffect, useRef } from "react";
import { ThemeToggle } from "../design/Theme";
import { NAV_ITEMS } from "../content/site.ts";
import { BrandMark } from "../components/BrandMark";
import { revealAnchor } from "../components/ResponsiveDetails";
import { useStory } from "../story/storyStore.ts";

export function Header() {
  const overFilm = useStory((s) => s.heroInView);
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        trigger.current?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false;
    };
    const media = window.matchMedia("(min-width: 960px)");
    const resize = () => { if (media.matches && menu.current) menu.current.open = false; };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    media.addEventListener("change", resize);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", outside); media.removeEventListener("change", resize); };
  }, []);
  return (
    <header className={`site-header${overFilm ? " is-over-film" : ""}`}>
      <a className="skip-link" href="#main">본문으로 건너뛰기</a>
      <div className="container site-header-inner">
        <a className="brand" href="#top" aria-label="TAPSO, 맨 위로">
          <BrandMark />
          <span className="brand-word" data-wordmark="TAPSO" aria-hidden="true">TAPS<span className="brand-word-o">O</span></span>
        </a>
        <nav className="site-nav" aria-label="페이지 안내"><ul>
          {NAV_ITEMS.map((item) => <li key={item.href}><a href={item.href}>{item.label}</a></li>)}
        </ul></nav>
        <div className="desktop-theme"><ThemeToggle /></div>
        <a className="btn btn-primary btn-sm header-cta" href="#status">개발 현황</a>
        <details className="mobile-menu" ref={menu} onBlur={(event) => {
          if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }}>
          <summary ref={trigger} aria-label="페이지 메뉴" aria-controls="mobile-navigation">메뉴<span className="disclosure-mark" aria-hidden="true" /></summary>
          <div className="mobile-menu-panel" id="mobile-navigation">
            <nav aria-label="모바일 페이지 안내"><ul>
              {NAV_ITEMS.map((item) => <li key={item.href}><a href={item.href} onClick={() => {
                if (menu.current) menu.current.open = false;
                const target = revealAnchor(item.href);
                if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
              }}>{item.label}</a></li>)}
              <li><a href="#privacy" onClick={() => {
                if (menu.current) menu.current.open = false;
                const target = revealAnchor("#privacy");
                if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
              }}>개인정보 원칙</a></li>
            </ul></nav>
            <ThemeToggle />
          </div>
        </details>
      </div>
    </header>
  );
}
