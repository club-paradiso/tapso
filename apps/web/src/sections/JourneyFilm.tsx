import { useState } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion';

/** An illustrated preview, not real footage or an app recording. */
export function JourneyFilm() {
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  return (
    <section className="journey-film" aria-labelledby="journey-film-title">
      <div className="journey-film-copy">
        <p>JEJU, THROUGH THE WINDOW</p>
        <h2 id="journey-film-title">창밖을 보는 동안,<br />탑서는 정거장을 봐요.</h2>
        <p>내릴 순간을 기다리는 대신, 제주를 천천히 바라보세요.</p>
      </div>
      <div className="journey-film-media">
        <video key={reduced ? 'still' : 'motion'} muted playsInline loop autoPlay={!reduced} controls preload="metadata" poster="/media/jeju-coast.webp" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} aria-label="제주 버스 창밖 풍경을 표현한 일러스트 영상">
          <source src="/media/jeju-journey.mp4" type="video/mp4" />
        </video>
        <span>영상은 생성 이미지에 움직임을 더한 연출이에요 · {playing ? '재생 중' : '일시 정지'}</span>
      </div>
    </section>
  );
}
