import OpenAI from 'openai';
import { AIRequest, EntityDetection, TransformationResult } from '../../types';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

interface AIConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

const defaultConfig: AIConfig = {
  model: 'gpt-4.1-nano',
  temperature: 0.3,
  maxTokens: 2000,
};

export async function detectEntities(text: string): Promise<EntityDetection[]> {
  if (!process.env.OPENAI_API_KEY) {
    return [];
  }

  try {
    const response = await openai.chat.completions.create({
      model: defaultConfig.model,
      temperature: defaultConfig.temperature,
      max_tokens: defaultConfig.maxTokens,
      messages: [
        {
          role: 'system',
          content: `You are a product code detection system for an industrial/technical parts catalog.

Analyze the given text and detect:
1. **Product codes** — alphanumeric identifiers for parts/items (e.g., ECO205.096.004, HDL-ECO205096004, T3558)
2. **Model numbers** — standalone model identifiers
3. **Part numbers** — component-level identifiers

For each detected entity, classify its type:
- "product_code" — full product code with prefix + digits
- "identifier" — standalone model/part reference
- "text" — not a code, regular text

Rules:
- A product code typically has a letter prefix followed by digits, possibly with separators
- ECO-prefixed codes are always product codes
- HDL-prefixed codes are always product codes
- Standalone numbers like T3558 may be product codes
- Measure specifications like 3/4" (19MM) are NOT product codes

Return a JSON array of entities with: entity, type, confidence (0-1), startIndex, endIndex.`,
        },
        {
          role: 'user',
          content: text,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('AI entity detection failed:', err);
    return [];
  }
}

export async function rewriteText(
  text: string,
  transformations: TransformationResult,
  instruction?: string
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return transformations.transformed;
  }

  const entityContext = transformations.entities
    .map(e => `  - "${e.entity}" → "${e.suggestedTransformation}" (${e.type})`)
    .join('\n');

  try {
    const response = await openai.chat.completions.create({
      model: defaultConfig.model,
      temperature: 0.2,
      max_tokens: defaultConfig.maxTokens,
      messages: [
        {
          role: 'system',
          content: `You are a precise PDF content transformer for industrial parts documentation.

You will receive:
1. Original text
2. Detected product codes and their suggested transformations
3. Optional user instruction

Your job: Apply the transformations to the text while preserving:
- Original formatting, line breaks, spacing
- Non-code text exactly as-is
- Measurement specifications (inches, mm, etc.)
- Part descriptions and titles

The transformations are:
${entityContext}

${instruction ? `Additional instruction from user:\n${instruction}` : ''}

Return ONLY the transformed text, no explanations.`,
        },
        {
          role: 'user',
          content: text,
        },
      ],
    });

    return response.choices[0]?.message?.content || transformations.transformed;
  } catch (err) {
    console.error('AI rewrite failed:', err);
    return transformations.transformed;
  }
}

let lastUsage: { prompt: number; cached: number; output: number; total: number } | null = null;
let accumulatedUsage: { prompt: number; cached: number; output: number; total: number } = { prompt: 0, cached: 0, output: 0, total: 0 };

export function getLastAiUsage() {
  return lastUsage;
}

export function getAccumulatedAiUsage() {
  return accumulatedUsage;
}

export function resetAccumulatedAiUsage() {
  accumulatedUsage = { prompt: 0, cached: 0, output: 0, total: 0 };
}

export type LogFn = (type: string, message: string) => void;

export interface GroupElementInput {
  content: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface GroupElementsOutput {
  groups: {
    indices: number[];
    isTable?: boolean;
  }[];
}

export async function groupElements(
  elements: GroupElementInput[],
  pageWidth: number,
  pageHeight: number,
  onLog?: LogFn
): Promise<GroupElementsOutput> {
  const elementsArr = elements.map((e, i) => ({
    i,
    c: e.content,
    x: e.x,
    y: e.y,
    f: e.fontSize,
  }));

  const msg = `AI grouping ${elements.length} elements on ${pageWidth}x${pageHeight} canvas`;
  console.log(`🧠 ${msg}`);
  onLog?.('ai', msg);
  elementsArr.forEach((e, i) => {
    const trunc = e.c.length > 120 ? e.c.slice(0, 120) + '...' : e.c;
    console.log(`  el ${i}: "${trunc}" x=${e.x} y=${e.y} font=${e.f}`);
  });
  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-nano',
    max_completion_tokens: 10000,
    // reasoning_effort: 'low' as any,
    response_format: { type: 'json_object' } as any,
    prompt_cache_retention: '24h' as any,
    messages: [
      {
        role: 'system',
        content: `You are a PDF document layout analyzer.

The page is a canvas of pageWidth × pageHeight pixels. (0, 0) is the top-left corner. Larger y = lower down on the page.

Group the text elements into the visual regions a human reader would naturally perceive on this page. Read the content and see the layout — figure out what belongs together as a coherent visual block (title block, bullet list, table, footer, label, etc.).

Each element has:
- i — index (its position in the input list)
- c — content (the text)
- x — horizontal center position in pixels
- y — vertical center position in pixels
- f — fontSize in points

Be aggressive about merging. Only split when elements are clearly separate visual regions that a human would see as distinct blocks. Every single element index on the page MUST belong to a group. Do not omit any elements. There must be NO ungrouped elements. Group labels, titles, headers, descriptions, or notes into coherent blocks.

Return ONLY a JSON object with NO markdown formatting:
{ "groups": [{ "indices": [0, 1, 2] }, { "indices": [3, 4] }] }`,
      },
      {
        role: 'user',
        content: JSON.stringify({ pageWidth, pageHeight, elements: elementsArr }),
      },
    ],
  } as any);

  const choice = response.choices[0];
  const content = choice?.message?.content;
  if (!content) {
    console.error('✗ Finish reason:', choice?.finish_reason);
    console.error('✗ Full AI response:', JSON.stringify(response, null, 2));
    if (choice?.message?.refusal) {
      throw new Error(`AI refused: ${choice.message.refusal}`);
    }
    throw new Error('AI returned empty response for grouping');
  }

  const u = response.usage;
  const cached = (u as any)?.prompt_tokens_details?.cached_tokens || 0;
  lastUsage = { prompt: u?.prompt_tokens || 0, cached, output: u?.completion_tokens || 0, total: u?.total_tokens || 0 };
  accumulatedUsage.prompt += lastUsage.prompt;
  accumulatedUsage.cached += cached;
  accumulatedUsage.output += lastUsage.output;
  accumulatedUsage.total += lastUsage.total;
  const doneMsg = `AI grouping done — in=${lastUsage.prompt} cached=${cached} out=${lastUsage.output} tot=${lastUsage.total}`;
  console.log(`✓ ${doneMsg}`);
  if (cached > 0) {
    const pct = ((cached / lastUsage.prompt) * 100).toFixed(0);
    console.log(`  💾 cache hit: ${cached}/${lastUsage.prompt} tokens (${pct}%)`);
  }
  onLog?.('ai', doneMsg);
  onLog?.('raw_response', content);
  console.log('=== RAW AI RESPONSE ===');
  console.log(content);
  let parsed: GroupElementsOutput;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    try {
      const groupsIdx = content.indexOf('"groups"');
      if (groupsIdx >= 0) {
        const start = content.lastIndexOf('{', groupsIdx);
        const end = content.lastIndexOf('}');
        if (start >= 0 && end > start) {
          parsed = JSON.parse(content.slice(start, end + 1));
        } else throw new Error('no brace pair');
      } else throw new Error('no groups key');
    } catch (e2) {
      console.error(`✗ AI returned invalid JSON (len=${content.length}):`);
      console.error(content);
      throw new Error(`AI returned invalid JSON for grouping: ${(e2 as Error).message}`);
    }
  }
  const countMsg = `${parsed.groups?.length || 0} groups`;
  console.log(`  ↳ ${countMsg}`);
  onLog?.('ai', countMsg);
  return parsed;
}

export async function analyzeSelection(
  request: AIRequest
): Promise<{ entities: EntityDetection[]; summary: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { entities: [], summary: 'AI not configured. Set OPENAI_API_KEY to enable AI features.' };
  }

  try {
    const response = await openai.chat.completions.create({
      model: defaultConfig.model,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: `You are analyzing selected text from a PDF document (likely technical/industrial parts documentation).

Analyze the selected text and provide:
1. A brief summary of what the text contains
2. Any detected product codes, part numbers, or identifiers

Return JSON: { "summary": "...", "entities": [...] }`,
        },
        {
          role: 'user',
          content: request.text,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return { entities: [], summary: 'No analysis available' };

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { entities: [], summary: content };

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('AI analysis failed:', err);
    return { entities: [], summary: 'Analysis failed' };
  }
}
