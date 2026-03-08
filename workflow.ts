type RetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
  multiplier?: number;
};

type WorkflowExecutionContext = {
  workflowRunId: string;
  profile: string;
  invokeTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  emitSpan(name: string, attrs?: Record<string, unknown>): void;
  emitMetric(
    name: string,
    value: number,
    type: 'counter' | 'gauge' | 'histogram',
    attrs?: Record<string, unknown>,
  ): void;
  getConfig<T = unknown>(path: string, fallback?: T): T;
};

type ToolNode = {
  kind: 'tool';
  id: string;
  toolName: string;
  input?: Record<string, unknown>;
  timeoutMs?: number;
  retry?: RetryPolicy;
};

type SequenceNode = {
  kind: 'sequence';
  id: string;
  steps: WorkflowNode[];
};

type BranchNode = {
  kind: 'branch';
  id: string;
  predicateId: string;
  predicateFn?: (ctx: WorkflowExecutionContext) => boolean | Promise<boolean>;
  whenTrue: WorkflowNode;
  whenFalse?: WorkflowNode;
};

type WorkflowNode = ToolNode | SequenceNode | BranchNode;

type WorkflowContract = {
  kind: 'workflow-contract';
  version: 1;
  id: string;
  displayName: string;
  description?: string;
  tags?: string[];
  timeoutMs?: number;
  defaultMaxConcurrency?: number;
  build(ctx: WorkflowExecutionContext): WorkflowNode;
  onStart?(ctx: WorkflowExecutionContext): Promise<void> | void;
  onFinish?(ctx: WorkflowExecutionContext, result: unknown): Promise<void> | void;
  onError?(ctx: WorkflowExecutionContext, error: Error): Promise<void> | void;
};

type SearchPattern = {
  name: string;
  regex?: string;
  query?: string;
  isRegex?: boolean;
  contextBefore?: number;
  contextAfter?: number;
};

function toolNode(
  id: string,
  toolName: string,
  options?: { input?: Record<string, unknown>; retry?: RetryPolicy; timeoutMs?: number },
): ToolNode {
  return {
    kind: 'tool',
    id,
    toolName,
    input: options?.input,
    retry: options?.retry,
    timeoutMs: options?.timeoutMs,
  };
}

function sequenceNode(id: string, steps: WorkflowNode[]): SequenceNode {
  return { kind: 'sequence', id, steps };
}

function branchNode(
  id: string,
  predicateId: string,
  whenTrue: WorkflowNode,
  whenFalse: WorkflowNode | undefined,
  predicateFn?: (ctx: WorkflowExecutionContext) => boolean | Promise<boolean>,
): BranchNode {
  return { kind: 'branch', id, predicateId, predicateFn, whenTrue, whenFalse };
}

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
    const patterns = ctx.getConfig<SearchPattern[]>(
      'workflows.jsBundleSearch.patterns',
      DEFAULT_PATTERNS,
    );
    const maxMatches = ctx.getConfig<number>('workflows.jsBundleSearch.maxMatches', 10);
    const enableNavigate = ctx.getConfig<boolean>('workflows.jsBundleSearch.enableNavigate', true);
    const enableAuthExtract = ctx.getConfig<boolean>('workflows.jsBundleSearch.enableAuthExtract', true);
    const enableCollectCode = ctx.getConfig<boolean>('workflows.jsBundleSearch.enableCollectCode', true);
    const enableRemoteSearch = ctx.getConfig<boolean>('workflows.jsBundleSearch.enableRemoteSearch', false);
    const collectMode = ctx.getConfig<string>('workflows.jsBundleSearch.collectMode', 'priority');

    const steps: WorkflowNode[] = [];

    if (enableNavigate) {
      steps.push(
        toolNode('navigate-app', 'page_navigate', {
          input: {
            url: appUrl,
            waitUntil: 'networkidle',
            enableNetworkMonitoring: true,
          },
        }),
      );
    }

    steps.push(
      branchNode(
        'auth-extract-branch',
        'js_bundle_search_auth_extract_enabled',
        toolNode('auth-extract', 'page_script_run', {
          input: { name: 'auth_extract' },
        }),
        toolNode('skip-auth-extract', 'console_execute', {
          input: {
            expression:
              '({ skipped: true, step: "auth_extract", reason: "workflows.jsBundleSearch.enableAuthExtract=false" })',
          },
        }),
        () => enableAuthExtract,
      ),
    );

    steps.push(
      branchNode(
        'collect-code-branch',
        'js_bundle_search_collect_code_enabled',
        toolNode('collect-code', 'collect_code', {
          input: {
            url: appUrl,
            smartMode: collectMode,
            includeDynamic: true,
            includeExternal: true,
            includeInline: true,
            compress: false,
            returnSummaryOnly: true,
            maxTotalSize: 16_000_000,
            maxFileSize: 2048,
            priorities: bundleUrl ? [bundleUrl] : undefined,
          },
          timeoutMs: 3 * 60_000,
        }),
        toolNode('skip-collect-code', 'console_execute', {
          input: {
            expression:
              '({ skipped: true, step: "collect_code", reason: "workflows.jsBundleSearch.enableCollectCode=false" })',
          },
        }),
        () => enableCollectCode,
      ),
    );

    for (const pattern of patterns) {
      const keyword = pattern.query ?? pattern.regex ?? pattern.name;
      const isRegex = pattern.isRegex ?? Boolean(pattern.regex && !pattern.query);
      steps.push(
        toolNode(`search-${pattern.name}`, 'search_in_scripts', {
          input: {
            keyword,
            isRegex,
            contextLines: 2,
            maxMatches,
            returnSummary: true,
          },
        }),
      );
    }

    steps.push(
      branchNode(
        'remote-search-branch',
        'js_bundle_search_remote_fetch_enabled',
        toolNode('remote-js-bundle-search', 'js_bundle_search', {
          input: {
            url: bundleUrl || appUrl,
            cacheBundle: true,
            stripNoise: true,
            maxMatches,
            patterns,
          },
        }),
        toolNode('skip-remote-search', 'console_execute', {
          input: {
            expression:
              '({ skipped: true, step: "js_bundle_search", reason: "workflows.jsBundleSearch.enableRemoteSearch=false" })',
          },
        }),
        () => enableRemoteSearch && Boolean(bundleUrl || appUrl),
      ),
    );

    steps.push(
      toolNode('emit-summary', 'console_execute', {
        input: {
          expression: `(${JSON.stringify({
            workflowId: 'workflow.js-bundle-search.v1',
            appUrl,
            bundleUrl,
            patterns: patterns.map((pattern) => ({ name: pattern.name, query: pattern.query ?? pattern.regex ?? pattern.name, isRegex: pattern.isRegex ?? Boolean(pattern.regex && !pattern.query) })),
            maxMatches,
            strategy: ['navigate', 'auth_extract', 'collect_code', 'search_in_scripts', 'optional_remote_js_bundle_search'],
          })})`,
        },
      }),
    );

    return sequenceNode('js-bundle-search-root', steps);
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
