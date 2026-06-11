import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors());
app.use(morgan('combined'));

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const ANYGEN_BASE_URL = process.env.ANYGEN_BASE_URL || 'https://www.anygen.io';
// Render/Railway 等平台通常会给 PORT；本服务默认 8080。
const ANYGEN_API_KEY = process.env.ANYGEN_API_KEY || '';
const GATEWAY_KEY = process.env.GATEWAY_KEY || '';

function requireGatewayAuth(req, res) {
  if (!GATEWAY_KEY) return true;
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1] || '';
  if (token !== GATEWAY_KEY) {
    res.status(401).json({
      error: {
        message: 'Unauthorized: invalid gateway key',
        type: 'invalid_request_error',
        code: 'unauthorized'
      }
    });
    return false;
  }
  return true;
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

const VIRTUAL_MODELS = [
  { id: 'anygen-slide（PPT：默认）', operation: 'slide' },
  { id: 'anygen-slide-pitch（PPT：融资路演）', operation: 'slide' },
  { id: 'anygen-slide-product（PPT：产品发布）', operation: 'slide' },
  { id: 'anygen-slide-training（PPT：培训课件）', operation: 'slide' },
  { id: 'anygen-slide-report（PPT：数据汇报）', operation: 'slide' },
  { id: 'anygen-slide-roadmap（PPT：规划路线图）', operation: 'slide' },
  { id: 'anygen-slide-mindmap（PPT：思维导图）', operation: 'slide' },
  { id: 'anygen-slide-lecture（PPT：讲座分享）', operation: 'slide' },
  { id: 'anygen-doc（文档：默认）', operation: 'doc' },
  { id: 'anygen-doc-report（文档：报告）', operation: 'doc' },
  { id: 'anygen-doc-prd（文档：PRD）', operation: 'doc' },
  { id: 'anygen-doc-proposal（文档：方案/投标）', operation: 'doc' },
  { id: 'anygen-doc-resume（文档：简历）', operation: 'doc' },
  { id: 'anygen-doc-meeting（文档：会议纪要）', operation: 'doc' },
  { id: 'anygen-doc-sop（文档：SOP/流程）', operation: 'doc' },
  { id: 'anygen-doc-whitepaper（文档：白皮书）', operation: 'doc' },
  { id: 'anygen-website（网站：默认）', operation: 'website' },
  { id: 'anygen-website-landing（网站：落地页）', operation: 'website' },
  { id: 'anygen-website-portfolio（网站：作品集）', operation: 'website' },
  { id: 'anygen-website-dashboard（网站：仪表盘）', operation: 'website' },
  { id: 'anygen-data-analysis（数据：分析报告）', operation: 'data_analysis' },
  { id: 'anygen-data-cleaning（数据：清洗整理）', operation: 'data_analysis' },
  { id: 'anygen-data-visualization（数据：可视化）', operation: 'data_analysis' },
  { id: 'anygen-deep-research（研究：深度调研）', operation: 'deep_research' },
  { id: 'anygen-research-brief（研究：快报简报）', operation: 'deep_research' },
  { id: 'anygen-smart-draw（制图：流程图/架构图）', operation: 'smart_draw' },
  { id: 'anygen-smart-draw-uml（制图：UML）', operation: 'smart_draw' },
  { id: 'anygen-image（图片：生成）', operation: 'image' },
  { id: 'anygen-storybook（绘本：故事书）', operation: 'storybook' },
  { id: 'anygen-video（视频：生成）', operation: 'video' }
];

function modelToOperation(model) {
  const found = VIRTUAL_MODELS.find(m => m.id === model);
  return found?.operation || 'slide';
}

function extractUserPrompt(body) {
  // OpenAI: {messages:[{role,content},...]} where content can be string or array.
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const parts = [];
  for (const msg of msgs) {
    const role = msg?.role || 'user';
    const c = msg?.content;
    if (typeof c === 'string') {
      parts.push(`${role}: ${c}`);
    } else if (Array.isArray(c)) {
      const text = c
        .map(x => (typeof x?.text === 'string' ? x.text : ''))
        .filter(Boolean)
        .join(' ');
      if (text) parts.push(`${role}: ${text}`);
    }
  }
  if (parts.length === 0 && typeof body?.prompt === 'string') return body.prompt;
  return parts.join('\n');
}

async function anygenTaskCreate({ operation, prompt }) {
  if (!ANYGEN_API_KEY) {
    throw new Error('Missing ANYGEN_API_KEY');
  }
  const url = `${ANYGEN_BASE_URL}/v1/openapi/tasks`;
  const payload = {
    auth_token: ANYGEN_API_KEY,
    operation,
    prompt,
    extra: {
      create_from: 'anygen-openai-gateway'
    }
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(`AnyGen HTTP ${r.status}: ${JSON.stringify(data)}`);
  }
  if (!data?.success) {
    throw new Error(`AnyGen create failed: ${data?.error || 'unknown error'}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function anygenTaskGet(taskId) {
  if (!ANYGEN_API_KEY) {
    throw new Error('Missing ANYGEN_API_KEY');
  }

  const url = `${ANYGEN_BASE_URL}/v1/openapi/tasks/${encodeURIComponent(taskId)}?auth_token=${encodeURIComponent(ANYGEN_API_KEY)}`;

  const r = await fetch(url, {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${ANYGEN_API_KEY}`
    }
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(`AnyGen HTTP ${r.status}: ${JSON.stringify(data)}`);
  }
  if (!data?.success) {
    throw new Error(`AnyGen get failed: ${data?.error || 'unknown error'}`);
  }
  return data;
}

function extractAnygenFileUrls(taskDetail) {
  const files = taskDetail?.output?.files;
  if (!Array.isArray(files)) return [];
  return files
    .map(f => (typeof f?.url === 'string' ? f.url : ''))
    .filter(Boolean);
}

async function waitAnygenTaskFiles(taskId, { timeoutMs = 60000, pollMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;

  while (Date.now() < deadline) {
    last = await anygenTaskGet(taskId);

    const status = String(last?.status || last?.data?.status || last?.state || last?.data?.state || '').toLowerCase();
    const urls = extractAnygenFileUrls(last?.data || last);

    if (urls.length > 0) return { status: status || 'completed', urls, detail: last };
    if (status && ['failed', 'error', 'canceled', 'cancelled'].includes(status)) {
      return { status, urls: [], detail: last };
    }

    await sleep(pollMs);
  }

  return { status: 'timeout', urls: [], detail: last };
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// OpenAI compatible: list models
app.get('/v1/models', (req, res) => {
  if (!requireGatewayAuth(req, res)) return;
  res.json({
    object: 'list',
    data: VIRTUAL_MODELS.map(m => ({
      id: m.id,
      object: 'model',
      created: 0,
      owned_by: 'anygen-gateway'
    }))
  });
});


// OpenAI compatible: images generations
app.post('/v1/images/generations', async (req, res) => {
  if (!requireGatewayAuth(req, res)) return;

  const model = req.body?.model || 'anygen-image（图片：生成）';
  const operation = modelToOperation(model) || 'image';
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
  const n = req.body?.n;
  const size = req.body?.size;

  const extra = [];
  if (n != null) extra.push(`n=${n}`);
  if (size) extra.push(`size=${size}`);
  const fullPrompt = extra.length ? `${prompt}\n\n[OpenAI image params: ${extra.join(', ')}]` : prompt;

  const waitSecondsEnv = process.env.IMAGE_WAIT_SECONDS ? Number(process.env.IMAGE_WAIT_SECONDS) : 60;
  const waitSecondsReq = req.body?.wait_seconds != null ? Number(req.body.wait_seconds) : undefined;
  const waitSeconds = Number.isFinite(waitSecondsReq) ? waitSecondsReq : waitSecondsEnv;
  const timeoutMs = Math.max(0, Math.min(waitSeconds, 300)) * 1000;

  try {
    const created = await anygenTaskCreate({
      operation: operation === 'image' ? 'image' : operation,
      prompt: fullPrompt
    });

    if (!timeoutMs) {
      return res.json({ created: nowUnix(), data: [{ url: created.task_url }] });
    }

    const waited = await waitAnygenTaskFiles(created.task_id, { timeoutMs, pollMs: 2000 });

    if (waited.urls.length > 0) {
      const count = (typeof n === 'number' && n > 0) ? Math.min(n, waited.urls.length) : waited.urls.length;
      return res.json({ created: nowUnix(), data: waited.urls.slice(0, count).map(url => ({ url })) });
    }

    return res.json({
      created: nowUnix(),
      data: [{ url: created.task_url }],
      anygen: {
        task_id: created.task_id,
        task_url: created.task_url,
        status: waited.status
      }
    });
  } catch (e) {
    res.status(500).json({
      error: {
        message: e?.message || String(e),
        type: 'server_error',
        code: 'anygen_gateway_error'
      }
    });
  }
});
// OpenAI compatible: chat completions
app.post('/v1/chat/completions', async (req, res) => {
  if (!requireGatewayAuth(req, res)) return;

  const model = req.body?.model || 'anygen-slide';
  const operation = modelToOperation(model);
  const prompt = extractUserPrompt(req.body);

  try {
    const created = await anygenTaskCreate({ operation, prompt });

    const assistantContent = JSON.stringify({
      ok: true,
      anygen: {
        operation,
        task_id: created.task_id,
        task_url: created.task_url,
        content_version: created.content_version
      },
      hint: 'Open task_url to view progress / edit in AnyGen.'
    }, null, 2);

    res.json({
      id: `chatcmpl_${created.task_id}`,
      object: 'chat.completion',
      created: nowUnix(),
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: assistantContent },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });
  } catch (e) {
    res.status(500).json({
      error: {
        message: e?.message || String(e),
        type: 'server_error',
        code: 'anygen_gateway_error'
      }
    });
  }
});

// Optional: some platforms still call /v1/completions
app.post('/v1/completions', async (req, res) => {
  if (!requireGatewayAuth(req, res)) return;
  const model = req.body?.model || 'anygen-slide';
  const operation = modelToOperation(model);
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
  try {
    const created = await anygenTaskCreate({ operation, prompt });
    const text = JSON.stringify({
      ok: true,
      anygen: {
        operation,
        task_id: created.task_id,
        task_url: created.task_url,
        content_version: created.content_version
      }
    });
    res.json({
      id: `cmpl_${created.task_id}`,
      object: 'text_completion',
      created: nowUnix(),
      model,
      choices: [{ index: 0, text, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });
  } catch (e) {
    res.status(500).json({
      error: {
        message: e?.message || String(e),
        type: 'server_error',
        code: 'anygen_gateway_error'
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`AnyGen OpenAI Gateway listening on :${PORT}`);
  console.log(`ANYGEN_BASE_URL=${ANYGEN_BASE_URL}`);
  console.log(`GATEWAY_KEY=${GATEWAY_KEY ? 'enabled' : 'disabled'}`);
});
