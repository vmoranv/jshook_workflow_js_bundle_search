import type { WorkflowContract } from '@jshookmcp/extension-sdk/workflow';
import { toolNode, sequenceNode, branchNode } from '@jshookmcp/extension-sdk/workflow';

type SearchPattern = {
  name: string;
  regex?: string;
  query?: string;
  isRegex?: boolean;
  contextBefore?: number;
  contextAfter?: number;
};

const DEFAULT_PATTERNS: SearchPattern[] = [
  { name: 'auth_signup', query: 'auths/signup', isRegex: false },
  { name: 'auth_signin', query: 'auths/signin', isRegex: false },
  { name: 'auth_activate', query: 'auths/activate', isRegex: false },
  { name: 'chat_completions_v2', query: '/api/v2/chat/completions', isRegex: false },
  { name: 'chats_v2', query: '/api/v2/chats', isRegex: false },
  { name: 'sha256', query: 'SHA-256', isRegex: false },
  { name: 'hash_hex', query: 'getHash("HEX")', isRegex: false },
];

const jsBundleSearchWorkflow: WorkflowContract = {
  kind: 'workflow-contract',
  version: 1,
  id: 'workflow.js-bundle-search.v1',
  displayName: 'JS Bundle Search',
  description:
    'Collect scripts from a live page and search them by regex patterns, with optional remote js_bundle_search as a secondary step.',
  tags: ['workflow', 'bundle', 'javascript', 'reverse-engineering', 'search'],
  timeoutMs: 8 * 60_000,
  defaultMaxConcurrency: 1,

  build(ctx) {
    const appUrl = ctx.getConfig<string>('workflows.jsBundleSearch.appUrl', '');
    if (!appUrl) throw new Error('[workflow.js-bundle-search] Missing required config: workflows.jsBundleSearch.appUrl');
    const bundleUrl = ctx.getConfig<string>('workflows.jsBundleSearch.bundleUrl', '');
    const patterns = ctx.getConfig<SearchPattern[]>('workflows.jsBundleSearch.patterns', DEFAULT_PATTERNS);
    const maxMatches = ctx.getConfig<number>('workflows.jsBundleSearch.maxMatches', 10);
    const enableNavigate = ctx.getConfig<boolean>('workflows.jsBundleSearch.enableNavigate', true);
    const enableAuthExtract = ctx.getConfig<boolean>('workflows.jsBundleSearch.enableAuthExtract', true);
    const enableCollectCode = ctx.getConfig<boolean>('workflows.jsBundleSearch.enableCollectCode', true);
    const enableRemoteSearch = ctx.getConfig<boolean>('workflows.jsBundleSearch.enableRemoteSearch', false);
    const collectMode = ctx.getConfig<string>('workflows.jsBundleSearch.collectMode', 'priority');

    const root = sequenceNode('js-bundle-search-root');

    if (enableNavigate) {
      root.step(toolNode('navigate-app', 'page_navigate').input({
        url: appUrl, waitUntil: 'networkidle', enableNetworkMonitoring: true,
      }));
    }

    root.step(branchNode('auth-extract-branch', 'js_bundle_search_auth_extract_enabled')
      .predicateFn(() => enableAuthExtract)
      .whenTrue(toolNode('auth-extract', 'page_script_run').input({ name: 'auth_extract' }))
      .whenFalse(toolNode('skip-auth-extract', 'console_execute').input({
        expression: '({ skipped: true, step: "auth_extract", reason: "workflows.jsBundleSearch.enableAuthExtract=false" })',
      })));

    root.step(branchNode('collect-code-branch', 'js_bundle_search_collect_code_enabled')
      .predicateFn(() => enableCollectCode)
      .whenTrue(toolNode('collect-code', 'collect_code')
        .input({
          url: appUrl, smartMode: collectMode, includeDynamic: true, includeExternal: true,
          includeInline: true, compress: false, returnSummaryOnly: true,
          maxTotalSize: 16_000_000, maxFileSize: 2048,
          priorities: bundleUrl ? [bundleUrl] : undefined,
        })
        .timeout(3 * 60_000))
      .whenFalse(toolNode('skip-collect-code', 'console_execute').input({
        expression: '({ skipped: true, step: "collect_code", reason: "workflows.jsBundleSearch.enableCollectCode=false" })',
      })));

    for (const pattern of patterns) {
      const keyword = pattern.query ?? pattern.regex ?? pattern.name;
      const isRegex = pattern.isRegex ?? Boolean(pattern.regex && !pattern.query);
      root.step(toolNode(`search-${pattern.name}`, 'search_in_scripts').input({
        keyword, isRegex, contextLines: 2, maxMatches, returnSummary: true,
      }));
    }

    root.step(branchNode('remote-search-branch', 'js_bundle_search_remote_fetch_enabled')
      .predicateFn(() => enableRemoteSearch && Boolean(bundleUrl || appUrl))
      .whenTrue(toolNode('remote-js-bundle-search', 'js_bundle_search').input({
        url: bundleUrl || appUrl, cacheBundle: true, stripNoise: true, maxMatches, patterns,
      }))
      .whenFalse(toolNode('skip-remote-search', 'console_execute').input({
        expression: '({ skipped: true, step: "js_bundle_search", reason: "workflows.jsBundleSearch.enableRemoteSearch=false" })',
      })));

    root.step(toolNode('emit-summary', 'console_execute').input({
      expression: `(${JSON.stringify({
        workflowId: 'workflow.js-bundle-search.v1',
        appUrl, bundleUrl,
        patterns: patterns.map((p) => ({ name: p.name, query: p.query ?? p.regex ?? p.name, isRegex: p.isRegex ?? Boolean(p.regex && !p.query) })),
        maxMatches,
        strategy: ['navigate', 'auth_extract', 'collect_code', 'search_in_scripts', 'optional_remote_js_bundle_search'],
      })})`,
    }));

    return root.build();
  },

  onStart(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId: 'workflow.js-bundle-search.v1', stage: 'start' });
  },

  onFinish(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId: 'workflow.js-bundle-search.v1', stage: 'finish' });
  },

  onError(ctx, error) {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', { workflowId: 'workflow.js-bundle-search.v1', error: error.name });
  },
};

export default jsBundleSearchWorkflow;
