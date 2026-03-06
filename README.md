# js-bundle-search workflow

Declarative workflow for remote JavaScript bundle analysis. It optionally extracts local auth context, runs multi-pattern bundle search, and emits a compact summary step for downstream tooling.

## Entry File

- `workflow.ts`

## Workflow ID

- `workflow.js-bundle-search.v1`

## Structure

This workflow wraps the built-in `js_bundle_search` tool in a small but reusable declarative graph:

- Optional `page_script_run(auth_extract)` pre-step for context collection
- Core `js_bundle_search` step with configurable regex patterns
- `console_execute` summary step to expose search intent and expected follow-up
- `BranchNode` guard so the auth-extract step can be toggled safely

## Tools Used

- `page_script_run`
- `js_bundle_search`
- `console_execute`

## Config

- `workflows.jsBundleSearch.bundleUrl`
- `workflows.jsBundleSearch.cacheBundle`
- `workflows.jsBundleSearch.stripNoise`
- `workflows.jsBundleSearch.maxMatches`
- `workflows.jsBundleSearch.patterns`
- `workflows.jsBundleSearch.enableAuthExtract`

Default example patterns cover payment endpoints, subscription-tier signals, and feature-flag markers.

## Local Validation

1. Run `pnpm install`.
2. Run `pnpm typecheck`.
3. Put this repo under a configured `workflows/` extension root.
4. Run `extensions_reload` in `jshookmcp`.
5. Confirm the workflow appears in `extensions_list`.
6. Execute the workflow and verify optional auth extraction, bundle match results, and summary output.
