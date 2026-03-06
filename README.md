# js-bundle-search workflow

Declarative workflow for searching remote JavaScript bundles with cached fetch and multi-pattern analysis.

## Entry File

- `workflow.ts`

## Workflow ID

- `workflow.js-bundle-search.v1`

## Structure

This workflow demonstrates a small end-to-end bundle analysis flow:

- Optional auth context extraction via `page_script_run(auth_extract)`
- Core bundle inspection via `js_bundle_search`
- Summary emission via `console_execute`
- `SequenceNode` orchestration with a `BranchNode` guard for optional pre-step

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

Default example patterns cover payment endpoints, subscription tier signals, and feature flags.

## Local Validation

1. Install deps with `pnpm install`.
2. Run `pnpm typecheck`.
3. Load the workflow repo through `jshookmcp` extension roots.
4. Run `extensions_reload` and confirm it appears in `extensions_list`.
5. Execute the workflow in your workflow runner and verify:
   - optional auth extraction runs when enabled
   - bundle search returns matches for configured patterns
   - summary step completes
