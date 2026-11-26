import { ZodError, z } from 'zod';
import { generateInterviewQuestions } from '../lib/jobToolkit';
import { matchResumeWithJd } from '../lib/jdMatcher';
import { analyzeResumeDiagnostics } from '../lib/resumeDiagnostics';
import { ResumeDocumentSchema } from '../schema/resumeSchema';
import { assertSafeSlug, LocalFsApiError, LocalResumeStore } from '../server/localFsApi';

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

const SlugArgsSchema = z.object({
  slug: z.string().min(1),
});

const MatchJdArgsSchema = z.object({
  slug: z.string().min(1),
  jdText: z.string().min(1),
});

const InterviewArgsSchema = z.object({
  slug: z.string().min(1),
  targetRole: z.string().optional(),
});

const UpsertArgsSchema = z.object({
  slug: z.string().min(1),
  document: z.unknown(),
  expectedRevision: z.string().min(1).nullable().optional(),
  allowMasterWrite: z.boolean().optional(),
  reason: z.string().optional(),
});

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_resumes',
    description: '列出本地母库 master.json 与 resumes/*.json 所有已保存简历版本摘要',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_resume',
    description: '读取并校验指定 slug（如 master 或 synthetic-job）的完整 ResumeDocument JSON',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '简历版本标识（master 或子版本文件名不含 .json）' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'diagnose_resume',
    description: '对指定版本简历执行零成本本地 HR 诊断体检（完整性、量化力度、篇幅、时间序），返回分数与发现项',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '简历版本标识' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'match_jd',
    description: '对比指定版本简历与目标岗位 JD 文本，计算关键词覆盖率、已命中与缺失关键词清单',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '简历版本标识' },
        jdText: { type: 'string', description: '目标岗位职位描述（JD）原文' },
      },
      required: ['slug', 'jdText'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_interview_questions',
    description: '基于指定版本简历内容生成 8–12 道高频面试深挖问题与 STAR 回答提纲',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '简历版本标识' },
        targetRole: { type: 'string', description: '可选的目标岗位名称，用于定制岗位问法' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_resume_version',
    description:
      '受本地启动权限控制的新建或覆盖岗位子版本简历；默认禁用直接写入，母库还需独立本地授权及显式参数',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '目标版本标识（仅允许字母/数字/连字符/下划线）' },
        document: { type: 'object', description: '完整的 ResumeDocument 对象' },
        allowMasterWrite: {
          type: 'boolean',
          description: '是否请求覆写母库；此参数本身不授予权限',
        },
        expectedRevision: { type: ['string', 'null'], description: '必须提供 get_resume 返回文档的 [id,updatedAt] JSON 字符串；新建时明确传 null' },
        reason: { type: 'string', description: '覆盖已有版本时写入快照的说明原因' },
      },
      required: ['slug', 'document', 'expectedRevision'],
      additionalProperties: false,
    },
  },
];

function toolSuccess(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function toolError(message: string, code = 'TOOL_ERROR') {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: message, code }, null, 2),
      },
    ],
    isError: true as const,
  };
}

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof LocalFsApiError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof ZodError) {
    const detail = err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return { code: 'SCHEMA_VALIDATION_ERROR', message: `Schema 校验失败: ${detail}` };
  }
  if (err instanceof Error) {
    return { code: 'ERROR', message: err.message };
  }
  return { code: 'UNKNOWN_ERROR', message: String(err) };
}

export interface McpWritePolicy {
  /** Trusted local launch configuration, never supplied by an MCP tool caller. */
  allowVersionWrite?: boolean;
  allowMasterWrite?: boolean;
}

export function createMcpDispatcher(store: LocalResumeStore, policy: Readonly<McpWritePolicy> = {}) {
  const allowVersionWrite = policy.allowVersionWrite === true;
  const allowMasterWrite = allowVersionWrite && policy.allowMasterWrite === true;
  async function executeTool(name: string, rawArgs: unknown) {
    try {
      switch (name) {
        case 'list_resumes': {
          const listing = await store.listResumes();
          return toolSuccess(listing);
        }

        case 'get_resume': {
          const { slug } = SlugArgsSchema.parse(rawArgs);
          const safeSlug = assertSafeSlug(slug);
          const doc = await store.getResume(safeSlug);
          return toolSuccess(doc);
        }

        case 'diagnose_resume': {
          const { slug } = SlugArgsSchema.parse(rawArgs);
          const safeSlug = assertSafeSlug(slug);
          const doc = await store.getResume(safeSlug);
          const report = analyzeResumeDiagnostics(doc);
          return toolSuccess({ slug: safeSlug, title: doc.title, report });
        }

        case 'match_jd': {
          const { slug, jdText } = MatchJdArgsSchema.parse(rawArgs);
          const safeSlug = assertSafeSlug(slug);
          const doc = await store.getResume(safeSlug);
          const match = matchResumeWithJd(doc, jdText);
          return toolSuccess({ slug: safeSlug, title: doc.title, match });
        }

        case 'generate_interview_questions': {
          const { slug, targetRole } = InterviewArgsSchema.parse(rawArgs);
          const safeSlug = assertSafeSlug(slug);
          const doc = await store.getResume(safeSlug);
          const questions = generateInterviewQuestions(doc, targetRole);
          return toolSuccess({
            slug: safeSlug,
            title: doc.title,
            targetRole: targetRole?.trim() || doc.basic.title,
            questions,
          });
        }

        case 'upsert_resume_version': {
          const parsedArgs = UpsertArgsSchema.parse(rawArgs);
          // Guard 1: safe slug check (blocks traversal, illegal chars)
          const safeSlug = assertSafeSlug(parsedArgs.slug);

          // A tool argument is a request, not authorization.
          if (!allowVersionWrite) return toolError('MCP 默认只读；直接写入必须由本地启动配置授权。', 'MCP_WRITE_DISABLED');
          if (safeSlug === 'master' && (!allowMasterWrite || parsedArgs.allowMasterWrite !== true)) {
            return toolError(
              '母库受保护；只有本地独立授权且显式请求时才允许修改。',
              'MASTER_WRITE_PROTECTED',
            );
          }

          // Guard 3: strict Zod schema check
          const validatedDoc = ResumeDocumentSchema.parse(parsedArgs.document);

          // Check the caller's explicit revision under the same lock as backup and write.
          if (parsedArgs.expectedRevision === undefined) {
            return toolError('必须先读取当前版本并提供 expectedRevision；新建时明确使用 null。', 'REVISION_REQUIRED');
          }
          const existed = parsedArgs.expectedRevision !== null;
          let snapshotCreatedId: string | null = null;
          const saved = await store.saveResume(safeSlug, validatedDoc, {
            expectedRevision: parsedArgs.expectedRevision,
            snapshotReason: parsedArgs.reason?.trim() || 'MCP upsert 覆盖前自动快照',
            onSnapshotCreated: snapshot => { snapshotCreatedId = snapshot.id; },
          });
          return toolSuccess({
            slug: safeSlug,
            existedBefore: existed,
            snapshotCreatedId,
            updatedAt: saved.updatedAt,
            title: saved.title,
          });
        }

        default:
          return null;
      }
    } catch (err) {
      const info = formatError(err);
      return toolError(info.message, info.code);
    }
  }

  async function handleMessage(rawMsg: unknown): Promise<JsonRpcResponse | null> {
    if (!rawMsg || typeof rawMsg !== 'object' || Array.isArray(rawMsg)) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid JSON-RPC request object' },
      };
    }

    const msg = rawMsg as Record<string, unknown>;
    const hasId = 'id' in msg && msg.id !== undefined;
    const id = hasId ? (msg.id as string | number | null) : null;
    const method = typeof msg.method === 'string' ? msg.method : '';

    if (msg.jsonrpc !== '2.0' || !method) {
      return hasId
        ? {
            jsonrpc: '2.0',
            id,
            error: { code: -32600, message: 'Invalid JSON-RPC 2.0 envelope' },
          }
        : null;
    }

    // Notifications (no id) do not emit a response in JSON-RPC 2.0 / MCP
    if (!hasId || method === 'notifications/initialized' || method.startsWith('notifications/')) {
      return null;
    }

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: 'resume-studio-mcp',
            version: '1.0.0',
          },
        },
      };
    }

    if (method === 'ping') {
      return {
        jsonrpc: '2.0',
        id,
        result: {},
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS,
        },
      };
    }

    if (method === 'tools/call') {
      const params =
        msg.params && typeof msg.params === 'object' ? (msg.params as Record<string, unknown>) : {};
      const toolName = typeof params.name === 'string' ? params.name : '';
      if (!toolName) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing tools/call params.name' },
        };
      }
      const args = params.arguments ?? {};
      const toolResult = await executeTool(toolName, args);
      if (toolResult === null) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Unknown tool: ${toolName}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: toolResult,
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  return {
    handleMessage,
    listTools: () => MCP_TOOLS,
  };
}
