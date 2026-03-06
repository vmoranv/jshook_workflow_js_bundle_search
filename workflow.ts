import {
  branchNode,
  sequenceNode,
  toolNode,
} from '@jshookmcp/extension-sdk/workflow';
import type { WorkflowContract } from '@jshookmcp/extension-sdk/workflow';

type SearchPattern = {
  name: string;
  regex: string;
  contextBefore?: number;
  contextAfter?: number;
};

const DEFAULT_PATTERNS: SearchPattern[] = [
  {
    name: 'payment_apis',
    regex: '/api/(?:v1/)?payment/[a-z_]+',
    contextBefore: 120,
    contextAfter: 160,
  },
  {
    name: 'subscription_tier',
    regex: 'subscription(?:Tier|Plan|Level)|user_tier|premium',
    contextBefore: 120,
    contextAfter: 160,
  },
  {
    name: 'feature_flags',
    regex: 'featureFlag|enable[A-Z][A-Za-z]+|experiment[A-Z][A-Za-z]+',
    contextBefore: 120,
    contextAfter: 160,
  },
];

const jsBundleSearchWorkflow: WorkflowContract = {
  kind: 'workflow-contract',
  version: 1,
  id: 'workflow.js-bundle-search.v1',
  displayName: 'JS Bundle Search',
  description:
    'Optionally extract auth context, search a remote JavaScript bundle with cached fetch and multi-pattern regex analysis, then emit a summary step.',
  tags: ['workflow', 'bundle', 'javascript', 'reverse-engineering', 'search'],
  timeoutMs: 5 * 60_000,
  defaultMaxConcurrency: 1,

  build(ctx) {
    const bundleUrl = ctx.getConfig<string>(
      'workflows.jsBundleSearch.bundleUrl',
      'https://example.com/assets/main.js',
    );
    const cacheBundle = ctx.getConfig<boolean>(
      'workflows.jsBundleSearch.cacheBundle',
      true,
    );
    const stripNoise = ctx.getConfig<boolean>(
      'workflows.jsBundleSearch.stripNoise',
      true,
    );
    const maxMatches = ctx.getConfig<number>(
      'workflows.jsBundleSearch.maxMatches',
      10,
    );
    const patterns = ctx.getConfig<SearchPattern[]>(
      'workflows.jsBundleSearch.patterns',
      DEFAULT_PATTERNS,
    );
    const enableAuthExtract = ctx.getConfig<boolean>(
      'workflows.jsBundleSearch.enableAuthExtract',
      true,
    );

    const authExtractBranch = branchNode(
      'auth-extract-branch',
      'js_bundle_search_auth_extract_enabled',
      toolNode('auth-extract', 'page_script_run', {
        input: {
          name: 'auth_extract',
        },
      }),
      toolNode('skip-auth-extract', 'console_execute', {
        input: {
          expression:
            '({ skipped: true, step: "auth_extract", reason: "workflows.jsBundleSearch.enableAuthExtract=false" })',
        },
      }),
      () => enableAuthExtract,
    );

    const searchBundle = toolNode('search-bundle', 'js_bundle_search', {
      input: {
        url: bundleUrl,
        cacheBundle,
        stripNoise,
        maxMatches,
        patterns,
      },
    });

    const summary = toolNode('emit-summary', 'console_execute', {
      input: {
        expression: `(${JSON.stringify({
          workflowId: 'workflow.js-bundle-search.v1',
          bundleUrl,
          patterns: patterns.map((pattern) => pattern.name),
          cacheBundle,
          stripNoise,
          maxMatches,
          note: 'Inspect js_bundle_search output for concrete matches and contexts.',
        })})`,
      },
    });

    return sequenceNode('js-bundle-search-root', [
      authExtractBranch,
      searchBundle,
      summary,
    ]);
  },

  onStart(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId: 'workflow.js-bundle-search.v1',
      stage: 'start',
    });
  },

  onFinish(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId: 'workflow.js-bundle-search.v1',
      stage: 'finish',
    });
  },

  onError(ctx, error) {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', {
      workflowId: 'workflow.js-bundle-search.v1',
      error: error.name,
    });
  },
};

export default jsBundleSearchWorkflow;
