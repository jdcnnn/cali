import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from '@supabase/supabase-js';
import { normalizeMeetingsForReview, type ParsedMeeting } from "../src/lib/scheduleValidation.js";

const MAX_OCR_LENGTH = 30000;
const MODEL_TIMEOUT_MS = 28000;
// openrouter/free is OpenRouter's own router: it randomly selects a free model
// that's currently healthy, so a single dead/throttled model behind it doesn't
// sink the request. The explicit slugs after it are a second line of defense
// in case the router call itself errors out.
const DEFAULT_MODELS = [
  'openrouter/free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'google/gemma-4-26b-a4b-it:free',
];
// A 429 is transient — retry the same model once, after a short jittered
// pause, before moving on to the next candidate.
const RATE_LIMIT_RETRY_MS = 1500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SYSTEM_PROMPT = `You are a schedule parser for RTU (Rizal Technological University) Registration/Assessment Forms.
Extract all enrolled subjects from the raw OCR text and return ONLY a valid JSON array — no explanation, no markdown, no code fences.

Each item must have exactly these fields:
  subject_code   (string, e.g. "ITP310")
  title          (string, full subject description)
  units          (number, one decimal place max, e.g. 3.0 or 1.5)
  block_section  (string, the Section Code column, e.g. "ICS-01-501A")
  day_code       (string, EXACTLY one character: M T W H F S U — H=Thursday, U=Sunday)
  starts_at      (string, 24hr HH:MM)
  ends_at        (string, 24hr HH:MM)
  room           (string, Classroom column value — empty string "" if N/A or blank)

Schedule column format used by RTU:
  "<DayCode> <start>a - <end>p" where "a" = AM and "p" = PM.
  Examples:
    "S 09:30a - 12:30p" → day_code "S", starts_at "09:30", ends_at "12:30"
    "M 07:30a - 09:00a" → day_code "M", starts_at "07:30", ends_at "09:00"
    "H 10:00a - 12:00p" → day_code "H", starts_at "10:00", ends_at "12:00"
    "U 10:00a - 01:00p" → day_code "U", starts_at "10:00", ends_at "13:00"
    "T 09:00a - 12:00p" → day_code "T", starts_at "09:00", ends_at "12:00"
  Always convert to 24hr: if suffix is "p" and hour < 12, add 12. If suffix is "a" and hour = 12, use 00.

Multi-day subjects:
  Some subjects list two schedule rows (e.g. "M 07:30a - 09:00a" on one line and "H 07:30a - 09:00a" below it).
  Emit one separate JSON object per schedule row, keeping the same subject_code, title, units, block_section.

Skip rules — do NOT emit an object if:
  The Schedule column contains "N/A" or is blank/missing.

Room rules:
  If Classroom is "N/A", "n/a", or blank, use empty string "".
  Never use the string "N/A" as a room value.
  Preserve the full classroom value, including spaces and numbers (for example, "LAB 2" must remain "LAB 2").

Day code rules:
  M=Monday, T=Tuesday, W=Wednesday, H=Thursday, F=Friday, S=Saturday, U=Sunday.
  Always exactly one character.

Never omit a field. Never add extra fields.`;

class OpenRouterHttpError extends Error {
  constructor(public status: number) {
    super(`OpenRouter returned HTTP ${status}`);
  }
}

async function callOpenRouterOnce(
  model: string,
  ocrText: string,
  apiKey: string,
): Promise<ParsedMeeting[]> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Title": "CALI",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Parse this RTU registration form OCR text:\n\n${ocrText}`,
        },
      ],
    }),
  });

  if (!res.ok) throw new OpenRouterHttpError(res.status);

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw: string = data.choices?.[0]?.message?.content ?? "";
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
  return normalizeMeetingsForReview(JSON.parse(cleaned) as unknown);
}

// One retry on 429 (rate limited) before giving up on this particular model,
// since a single throttle response doesn't mean the model is actually down.
async function callOpenRouter(
  model: string,
  ocrText: string,
  apiKey: string,
): Promise<ParsedMeeting[]> {
  try {
    return await callOpenRouterOnce(model, ocrText, apiKey);
  } catch (error) {
    if (error instanceof OpenRouterHttpError && error.status === 429) {
      console.warn('[parse-schedule] rate limited, retrying once:', model);
      await sleep(RATE_LIMIT_RETRY_MS + Math.floor(Math.random() * 500));
      return callOpenRouterOnce(model, ocrText, apiKey);
    }
    throw error;
  }
}

export async function parseScheduleText(ocrText: string, apiKey: string, model = 'openrouter/free') {
  if (!apiKey) throw new Error('OPENROUTER_SCHEDULE_KEY is not configured on the server.');
  const models = [...new Set(model === 'openrouter/free' ? DEFAULT_MODELS : [model, ...DEFAULT_MODELS])];
  let lastError: unknown;
  for (const candidate of models) {
    console.info('[parse-schedule] trying model:', candidate);
    try {
      const meetings = await callOpenRouter(candidate, ocrText, apiKey);
      console.info('[parse-schedule] parsed meetings:', meetings.length);
      return meetings;
    } catch (error) {
      lastError = error;
      console.error('[parse-schedule] model failed:', candidate, error);
    }
  }
  throw lastError ?? new Error('No parser model was available.');
}

export async function verifyScheduleUser(authorization: string | undefined, url: string | undefined, anonKey: string | undefined) {
  if (!url || !anonKey) throw new Error('Supabase is not configured on the server.');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return false;
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await client.auth.getUser(token);
  return !error && Boolean(user);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const ocrText = (req.body as { ocrText?: unknown } | null)?.ocrText;
  if (typeof ocrText !== 'string' || !ocrText.trim())
    return res.status(400).json({ error: "OCR text is required." });
  if (ocrText.length > MAX_OCR_LENGTH)
    return res.status(413).json({ error: "OCR text is too long. Try a clearer crop of the schedule table." });
  try {
    if (!await verifyScheduleUser(req.headers.authorization, process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY))
      return res.status(401).json({ error: 'Please sign in again to scan your form.' });
  } catch (error) {
    console.error('[parse-schedule] auth failed:', error);
    return res.status(503).json({ error: 'Form scanning is unavailable right now.' });
  }
  if (!process.env.OPENROUTER_SCHEDULE_KEY)
    return res.status(503).json({ error: 'Form scanning is unavailable right now.' });

  try {
    console.info('[parse-schedule] request started:', { characters: ocrText.length });
    const meetings = await parseScheduleText(ocrText, process.env.OPENROUTER_SCHEDULE_KEY,
      process.env.OPENROUTER_SCHEDULE_MODEL);
    return res.status(200).json({ meetings });
  } catch (error) {
    console.error('[parse-schedule] failed:', error);
    return res.status(502).json({ error: 'We could not read the class details. Try a clearer image or add classes manually.' });
  }
}