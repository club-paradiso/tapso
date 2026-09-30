/**
 * Claims the marketing site must never make, because they are not true of
 * TAPSO today (README › Current status, docs/KNOWN_ISSUES.md) or because the
 * product rules forbid them (docs/DESIGN_PRINCIPLES.md 14: no percentages or
 * engineering terms for uncertainty).
 *
 * Checked twice: against the component sources by `test/marketingCopy.test.ts`
 * and against the prerendered HTML by `scripts/prerender.mjs`, which fails the
 * build.
 */
export type ForbiddenClaim = {
  pattern: RegExp;
  reason: string;
  /** Checked on rendered text only: source code legitimately uses the pattern (CSS percentages). */
  renderedOnly?: boolean;
};

export const FORBIDDEN_CLAIMS: readonly ForbiddenClaim[] = [
  { pattern: /지금\s*(바로\s*)?다운로드/, reason: "the app cannot be downloaded" },
  { pattern: /App\s*Store에서\s*(다운로드|받|만나)/, reason: "not on the App Store" },
  { pattern: /출시(됐|되었|했습|했어)/, reason: "not launched" },
  { pattern: /TestFlight(가|를|에)?\s*(지금\s*)?(열렸|열려\s*있|참여할\s*수\s*있|시작했)/, reason: "TestFlight is not open" },
  { pattern: /브라우저에서\s*(바로\s*)?(체험|사용해|써\s*보|이용)/, reason: "the website is not a browser version of TAPSO" },
  { pattern: /(신뢰도|정확도|확률|일치율)\s*\d/, reason: "no confidence numbers" },
  { pattern: /\d+(\.\d+)?\s*%/, reason: "no percentages", renderedOnly: true },
  { pattern: /자동으로\s*(버스를\s*)?(찾아\s*(드려|줘|내)|인식|골라)/, reason: "automatic vehicle selection is off" },
  { pattern: /(기부금\s*영수증|세액\s*공제)(을|를|이)?\s*(발급|드려|받을\s*수)/, reason: "no receipts or tax deduction exist" },
  { pattern: /비영리\s*(단체|법인)(입니다|이에요|예요)/, reason: "TAPSO is not a non-profit" },
  { pattern: /\b(matcher|READY_FOR_\w+|VERIFIED\w*|shadow mode)\b/i, reason: "no internal matcher terminology" },
  { pattern: /\d+(만|천)?\s*명(이|의)?\s*(사용|이용|선택|대기)/, reason: "no invented social proof" },
  { pattern: /Android\s*(버전|앱)?(도|을|를|이)?\s*(출시|지원)(해요|합니다|중)/, reason: "no Android build is planned" },
];
