# Coding Style Guide

> 此文件定义团队编码规范，所有 LLM 工具在修改代码时必须遵守。
> 提交到 Git，团队共享。

## General
- Prefer small, reviewable changes; avoid unrelated refactors.
- Keep functions short (<50 lines); avoid deep nesting (≤3 levels).
- Name things explicitly; no single-letter variables except loop counters.
- Handle errors explicitly; never swallow errors silently.

## Language-Specific

### TypeScript / React (this project)
- Strict TypeScript: `npm run typecheck` must pass; no `any` unless interfacing
  with untyped third-party payloads (then narrow immediately).
- Services (`src/services/`) are framework-free modules; React state lives in
  `src/stores/pagesStore.tsx` (Context + useReducer). Communicate service → UI
  via the `ocrEvents` mitt bus, never by importing React into services.
- Heavy/optional features (pdf, docx, epub, markdown render) are lazy-loaded
  via dynamic `import()` in `App.tsx` — keep new exporters on this pattern.
- Persist through `src/db/index.ts` (Dexie) methods only; new tables require a
  numbered schema version and cascade-delete coverage.
- All user-facing strings go through i18next: add keys to BOTH
  `src/i18n/locales/zh-CN.ts` and `en.ts`.
- Comments in English, matching the existing codebase; explain constraints,
  not what the next line does.

## Git Commits
- Conventional Commits, imperative mood, English (matches repo history).
- Atomic commits: one logical change per commit.

## Testing
- Every feat/fix MUST include corresponding tests.
- E2E via Playwright (`tests/e2e/specs/`); browser-context module imports use
  the `/src/...ts` Vite URL pattern, fixtures via `fixtures/base-test.ts`.
- Beware stale dev servers (`reuseExistingServer: true`): after editing source
  mid-session, kill the lingering server or module instances duplicate.
- Coverage must not decrease.
- Fix flow: write failing test FIRST, then fix code.

## Security
- Never log secrets (tokens/keys/cookies/JWT).
- Validate inputs at trust boundaries (URL protocol checks, bbox validation).
- API keys live in localStorage only; never hardcode endpoints with credentials.
