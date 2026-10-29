# TAPSO · 제주 영상 최적화

이 작업은 **실제 원본 영상**을 2종의 MP4와 2종의 WebP 포스터로 변환합니다. 확인되지 않은 영상 URL을 사이트에 노출하지 않습니다.

## 영상 출처

- [제주 우도 해변](https://pixabay.com/videos/korea-jeju-beach-sea-island-262066/) · somedaywish · Pixabay Content License
- [제주 중문 해변 파도](https://pixabay.com/videos/wave-sea-ocean-jeju-289799/) · Life_Vitamin · Pixabay Content License

다운로드 후 원본을 저장소에 커밋하지 마세요. Pixabay Content License는 독립된 원본 영상의 재배포를 제한합니다. 원본은 로컬에서만 사용하고, TAPSO 페이지에 포함될 짧은 편집본만 배포합니다.

## 로컬에서 실행

Mac에서 `brew install ffmpeg` 후:

```bash
python3 scripts/media/ingest_jeju_videos.py \
  --udo-source ~/Downloads/udo-original.mp4 \
  --jungmun-source ~/Downloads/jungmun-original.mp4
```

두 원본은 위 출처에서 직접 다운로드한 MP4여야 합니다. 파일명은 달라도 됩니다. 예상 출력:

| 위치 | 용도 |
|---|---|
| `apps/web/public/media/hero/udo-720.mp4` | 1280×720, 24fps, H.264, 소리 없음 |
| `apps/web/public/media/hero/udo-portrait.mp4` | 720×1280, 24fps, H.264, 소리 없음 |
| `apps/web/public/media/hero/udo-poster.webp` | 1600×900, 정적 대체 이미지 |
| `apps/web/public/media/hero/udo-poster-portrait.webp` | 720×1280, 모바일 대체 이미지 |
| `apps/web/public/media/hero/jungmun-*` | 같은 사양의 4개 파일 |

총 8개 파일. 영상은 9초이며 각 MP4 7MB 이하, 포스터 500KB 이하 제한과 FFprobe 검증을 거칩니다. 출력 파일별 SHA-256 값은 터미널에 출력됩니다.

## GitHub Actions

`.github/workflows/prepare-jeju-media.yml`에도 동일한 변환을 수행하는 작업이 있습니다. GitHub 실행기는 Pixabay 공개 다운로드 페이지에 접근하려 할 때 Cloudflare HTTP 403 차단을 받았습니다. 현재까지 **원본 확보와 영상 생성은 완료되지 않았습니다**.

Pixabay 계정 소유자의 API 키를 GitHub Actions 시크릿 `PIXABAY_API_KEY`로 제공할 경우, 공식 API 경로로 원본을 받아 처리할 수 있습니다. 시크릿을 코드/로그에 노출하지 마세요. 로컬 원본 MP4를 제공하는 경로가 가장 단순하고 안정적입니다.

**릴리스 게이트:** 실제 편집본 파일이 존재하고 `media.ts`에 명시적으로 등록되며 출처 기록과 테스트를 통과한 뒤에만 사이트 장면 선택 UI에 노출합니다. 파일 없는 버튼이나 잘못된 지역 영상은 만들지 않습니다.
