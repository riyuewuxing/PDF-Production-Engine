export interface ByokAiSettings {
  enabled: boolean;
  providerLabel: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_BYOK_SETTINGS: ByokAiSettings = {
  enabled: false,
  providerLabel: 'DeepSeek (OpenAI 兼容)',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
};

export const BYOK_PROVIDER_PRESETS: Array<{
  label: string;
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
}> = [
  {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    requiresKey: true,
  },
  {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    requiresKey: true,
  },
  {
    label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    requiresKey: true,
  },
  {
    label: 'Gemini OpenAI 兼容',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    requiresKey: true,
  },
  {
    label: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    requiresKey: false,
  },
];

export type PolishMode = 'star' | 'pedagogy' | 'concise';

export interface LineDiffSegment {
  type: 'same' | 'removed' | 'added';
  text: string;
}

export function computeLineDiff(original: string, suggested: string): LineDiffSegment[] {
  const origLines = original.split(/\r?\n/);
  const nextLines = suggested.split(/\r?\n/);
  const segments: LineDiffSegment[] = [];
  const maxLen = Math.max(origLines.length, nextLines.length);

  for (let i = 0; i < maxLen; i++) {
    const a = origLines[i];
    const b = nextLines[i];
    if (a === b && a !== undefined) {
      segments.push({ type: 'same', text: a });
    } else {
      if (a !== undefined && a.length > 0) {
        segments.push({ type: 'removed', text: a });
      }
      if (b !== undefined && b.length > 0) {
        segments.push({ type: 'added', text: b });
      }
    }
  }
  return segments;
}

export async function requestByokCompletion(params: {
  settings: ByokAiSettings;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const { settings, systemPrompt, userPrompt, temperature = 0.35, maxTokens, timeoutMs = 45000, signal } =
    params;
  if (!settings.enabled) {
    throw new Error('请先在下方开启并保存 BYOK 大模型配置，再调用 AI 能力。');
  }
  const baseUrl = settings.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('缺少模型 API Base URL。');
  }
  const isLocalOllama = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseUrl);
  if (!isLocalOllama && !settings.apiKey.trim()) {
    throw new Error('缺少 API Key（密钥仅存于本地 data/.ai-settings.json，不会上传或入库）。');
  }
  if (signal?.aborted) {
    throw new Error('请求已取消');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const bodyPayload: Record<string, unknown> = {
      model: settings.model.trim() || 'deepseek-chat',
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
    if (typeof maxTokens === 'number' && maxTokens > 0) {
      bodyPayload.max_tokens = maxTokens;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `模型接口返回错误 (${response.status}): ${errText.slice(0, 180) || response.statusText}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const result = payload.choices?.[0]?.message?.content?.trim();
    if (!result) {
      throw new Error('模型未返回有效文本内容。');
    }
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function polishResumeBlockWithByok(params: {
  settings: ByokAiSettings;
  mode: PolishMode;
  targetTitle: string;
  content: string;
  jobTitle?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { settings, mode, targetTitle, content, jobTitle, signal } = params;
  if (!content.trim()) {
    throw new Error('所选片段当前内容为空，请先填写基础事实再润色。');
  }

  const modePrompt =
    mode === 'star'
      ? '使用 STAR 法则增强动作与结果量化表达（不凭空捏造真实不存在的数字，如缺数据可用“[可补具体数字]”提示）。'
      : mode === 'pedagogy'
        ? '重点强化教学设计、课程标准、分层辅导、课堂实效与教研成果等教育行业专业表达。'
        : '精简冗余修饰词，提炼高信息密度核心句，保持每条以 `- **关键词**：` 开头的清晰 Markdown 列表格式。';

  const systemPrompt =
    '你是资深简历优化顾问。严禁编造虚假学历、工作单位、具体成绩或证书；严格保持客观事实不变，只输出改写后的纯正文或 Markdown 列表（不要加解释开场白或代码块包裹）。';
  const userPrompt = `目标岗位：${jobTitle || '未指定'}\n段落名称：${targetTitle}\n优化要求：${modePrompt}\n\n原文：\n${content}`;

  return requestByokCompletion({
    settings,
    systemPrompt,
    userPrompt,
    temperature: 0.35,
    timeoutMs: 35000,
    signal,
  });
}
