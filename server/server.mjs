// Small local backend: serves the page and forwards chat messages to Claude.
// The API key stays here (read from .env or the environment) and never
// reaches the browser. Start with `npm start`, then open http://localhost:3000.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const PUBLIC = path.join(ROOT, 'public');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file: fall back to the real environment.
}

const Model = createRequire(import.meta.url)('../public/js/model.js');

const PORT = Number(process.env.PORT) || 3000;
// Localhost only by default, so nobody else on the network can spend the key.
const HOST = process.env.HOST || '127.0.0.1';
const CHAT_MODEL = process.env.CHAT_MODEL || 'claude-opus-5-5';
const CHAT_EFFORT = process.env.CHAT_EFFORT || 'medium';
const MAX_BODY = 300_000;

// USD per million tokens, for the rough cost shown under the chat box.
const PRICES = {
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-fable-5-1': [10, 50],
};
// Models that accept the server-side refusal fallback.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasKey ? new Anthropic() : null;

const SYSTEM = `You help develop invention concepts on a page called Concept Bench. The page shows a concept sheet, a module diagram, an image prompt, simple calculators and a rough 3D shape, all generated from one project JSON object that you can rewrite.

The person often dictates by voice, so messages can be loose or contain transcription slips. Work out what they mean. Keep replies short and plain: a few sentences, no headings or Markdown. They like to work in small stages, so change what they ask for and suggest at most one next step. This is a concept and design project; they are not building hardware yet.

How the project JSON works:
- name, summary, goal, approach, status: short plain text.
- modules: list of {id, name, role, details, look, placement, links}. id is a stable lowercase slug: keep existing ids and make new ones from the name. role is what the module does, in one line. details holds specifics and numbers. look is how it appears in the product render, for example "the cable reel". placement is "inside" (in the main unit, shown in the cutaway) or "outside" (a separate part, shown beside it). links is [{to: module id, label: what flows or holds, for example "15 W"}].
- openQuestions, laterExperiments: lists of short strings.
- image: {subject, body, extras, style}. The page composes these with each module's look into one prompt for a single clean product render on a plain background with studio lighting. Keep it to one product, no people or scenery.
- calc: inputs for the calculators. Use only these keys: panelW (W), realFactorPct (% of the rating you get in real sun), sunHours (h per day), capacityMah, cellV, outputEffPct, loadW, phoneMah, phoneV, chargeEffPct, wallW, massG, travelMm, stepsPerS, convEffPct, walkHoursPerDay, dailyUseWh, cellType ("18650", "21700" or "pouch"), packOverheadPct, panelEffPct, panelFolds.
  Formulas: usable solar W = panelW × realFactorPct. Battery Wh = mAh × V ÷ 1000. Recharge hours = Wh ÷ (charging W × chargeEffPct). Walking generator W = mass kg × 9.81 × travel m × steps per second × convEffPct. Phone charges = Wh × outputEffPct ÷ phone Wh. The sizing check compares cell volume × (1 + packOverheadPct) with the body volume w × h × d.
- shape: {body: "roundedBox" | "box" | "cylinder" | "capsule" | "sphere", w, h, d in mm, radius in mm, color "#rrggbb", parts: [{name, shape: "box" | "roundedBox" | "cylinder" | "torus" | "sphere", size [a, b, c], position [x, y, z] in mm from the body centre, rotation [x, y, z] in degrees, color}]}. For a cylinder size is [radius, length, 0], for a torus [ring radius, tube radius, 0], for a sphere [radius, 0, 0]. It is a rough model, not a render.

Rules:
- Estimates come only from the simple formulas above. There is no physics simulation; say so if asked for one.
- Be straight about physics. Nothing gives endless energy; harvesters only top up a battery. Small harvesters such as a walking generator give fractions of a watt.
- If the message is a question or discussion, answer it and set project_json to an empty string.
- If the design should change, put the complete updated project in project_json (every field, not just the changes) and say in reply what you changed.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'What to show in the chat.' },
    project_json: {
      type: 'string',
      description: 'The complete updated project as a JSON string, or an empty string when nothing changes.',
    },
  },
  required: ['reply', 'project_json'],
  additionalProperties: false,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body is not valid JSON.'), { status: 400 });
  }
}

function estimateCost(model, usage) {
  const [inP, outP] = PRICES[model] || PRICES[CHAT_MODEL] || [0, 0];
  const input =
    (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) * 1.25 +
    (usage.cache_read_input_tokens || 0) * 0.1;
  return (input * inP + (usage.output_tokens || 0) * outP) / 1e6;
}

function buildUserMessage(project, history, message) {
  const convo = history.length
    ? history.map((m) => `${m.role === 'user' ? 'Them' : 'You'}: ${m.text}`).join('\n')
    : '(no earlier messages)';
  return `Current project JSON:
<project>
${JSON.stringify(project)}
</project>

Conversation so far, oldest first:
<conversation>
${convo}
</conversation>

Their new message:
<message>
${message}
</message>`;
}

async function handleChat(req, res) {
  if (!client) {
    return sendJson(res, 503, { error: 'No API key on the server. Add ANTHROPIC_API_KEY to .env and restart.' });
  }
  const body = await readJson(req);
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
  if (!message) return sendJson(res, 400, { error: 'The message is empty.' });
  const project = Model.normalizeProject(body.project);
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .slice(-16)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));

  const params = {
    model: CHAT_MODEL,
    max_tokens: 16000,
    output_config: { effort: CHAT_EFFORT, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    // One self-contained user turn each time: the current design plus the
    // conversation as text, so no earlier model output is replayed.
    messages: [{ role: 'user', content: buildUserMessage(project, history, message) }],
  };
  if (FALLBACK_MODELS.has(CHAT_MODEL)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  let response;
  try {
    response = await client.beta.messages.create(params);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return sendJson(res, 502, { error: 'The API key was rejected. Check ANTHROPIC_API_KEY in .env.' });
    if (err instanceof Anthropic.RateLimitError) return sendJson(res, 429, { error: 'Too many requests right now. Wait a minute and try again.' });
    if (err instanceof Anthropic.BadRequestError) return sendJson(res, 502, { error: `The API refused the request: ${err.message}` });
    if (err instanceof Anthropic.APIConnectionError) return sendJson(res, 502, { error: 'Could not reach the API. Check the internet connection.' });
    if (err instanceof Anthropic.APIError) return sendJson(res, 502, { error: `API error ${err.status ?? ''}: ${err.message}` });
    throw err;
  }

  const usage = { ...response.usage, costUsd: estimateCost(response.model, response.usage || {}) };
  if (response.stop_reason === 'refusal') {
    return sendJson(res, 200, { reply: 'The model declined to answer that one. Try rephrasing it.', project: null, usage, model: response.model });
  }
  if (response.stop_reason === 'max_tokens') {
    return sendJson(res, 502, { error: 'The reply ran out of room before it finished. Try a smaller change.' });
  }

  // If a fallback model took over, only the text after the switch counts.
  const lastSwitch = response.content.map((b) => b.type).lastIndexOf('fallback');
  const text = response.content
    .slice(lastSwitch + 1)
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let out;
  try {
    out = JSON.parse(text);
  } catch {
    return sendJson(res, 502, { error: 'The model reply was not in the expected format. Try again.' });
  }

  let updated = null;
  let reply = typeof out.reply === 'string' ? out.reply : '';
  if (typeof out.project_json === 'string' && out.project_json.trim()) {
    try {
      updated = Model.normalizeProject(JSON.parse(out.project_json));
    } catch {
      reply += '\n\n(The suggested design change could not be read, so nothing on the page was changed.)';
    }
  }
  sendJson(res, 200, { reply, project: updated, usage, model: response.model });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/api/status' && req.method === 'GET') {
      return sendJson(res, 200, { chat: Boolean(client), model: CHAT_MODEL });
    }
    if (pathname === '/api/chat') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' });
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        return sendJson(res, 415, { error: 'Send JSON.' });
      }
      return await handleChat(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
    return await serveStatic(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong on the server.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Concept Bench running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(client ? `Chat is on (model ${CHAT_MODEL}, effort ${CHAT_EFFORT}).` : 'Chat is off: add ANTHROPIC_API_KEY to .env to turn it on.');
});
