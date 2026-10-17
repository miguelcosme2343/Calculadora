// Lectura de fórmulas en imágenes (capturas, fotos, imágenes compartidas) con Claude o Gemini.
// La clave la pone el usuario en Ajustes y se guarda solo en este dispositivo (localStorage);
// las llamadas van directamente del navegador al proveedor, sin servidor intermedio.
import Anthropic from '@anthropic-ai/sdk';

export type OcrProvider = 'gemini' | 'claude';
export interface OcrConfig { provider: OcrProvider; geminiKey: string; claudeKey: string }

const STORE_KEY = 'ocr';
export const CLAUDE_MODEL = 'claude-opus-5-5';
export const GEMINI_MODEL = 'gemini-3.5-flash';

export function loadOcr(): OcrConfig {
  const def: OcrConfig = { provider: 'gemini', geminiKey: '', claudeKey: '' };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') };
  } catch {
    return def;
  }
}
export function saveOcr(c: OcrConfig) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(c)); } catch { /* sin almacenamiento */ }
}

export class OcrError extends Error {
  constructor(message: string, readonly needsKey = false) {
    super(message);
  }
}

const SYSTEM = `Eres el lector de fórmulas de una calculadora. Transcribe a LaTeX la expresión, ecuación o sistema matemático de la imagen.

Reglas:
- Devuelve SOLO el LaTeX: sin $, sin \\[ \\], sin bloques de código y sin explicaciones.
- Fracciones con \\frac{}{}, raíces con \\sqrt{} o \\sqrt[n]{}, potencias con ^{}, productos explícitos con \\cdot, paréntesis con \\left( \\right).
- Unidad imaginaria: escribe i o j tal como aparezca. Fasores con \\angle (por ejemplo 10\\angle 30^{\\circ}). Impedancias en paralelo con \\parallel.
- Sistemas de ecuaciones con \\begin{cases} … \\\\ … \\end{cases}. Matrices con \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}; determinantes con vmatrix.
- Derivadas con \\frac{\\mathrm{d}}{\\mathrm{d}x}, integrales con \\int_{a}^{b} … \\,\\mathrm{d}x, límites con \\lim_{x\\to a}, sumatorios con \\sum_{n=a}^{b}.
- Omite el texto que no sea matemático (enunciados, números de ejercicio, unidades sueltas). Si hay varias expresiones independientes, transcribe la principal.
- Si la imagen no contiene matemáticas, devuelve exactamente NINGUNA.`;

const PROMPT = 'Transcribe la fórmula de esta imagen.';

// Reduce la imagen (los modelos no necesitan más de ~1600 px) y la pasa a base64
async function prepare(blob: Blob): Promise<{ data: string; mime: 'image/jpeg' | 'image/png' }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new OcrError('No se puede abrir la imagen');
  }
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // las capturas con transparencia se leen mejor sobre blanco
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const mime = 'image/jpeg';
  const url = canvas.toDataURL(mime, 0.92);
  return { data: url.slice(url.indexOf(',') + 1), mime };
}

// Quita envoltorios que a veces añaden los modelos
function clean(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:latex|tex)?\s*/i, '').replace(/```$/, '').trim();
  t = t.replace(/^\$\$?|\$\$?$/g, '').replace(/^\\\[|\\\]$/g, '').replace(/^\\\(|\\\)$/g, '').trim();
  if (!t || /^NINGUNA\.?$/i.test(t)) throw new OcrError('No se ve ninguna fórmula en la imagen');
  return t;
}

async function viaClaude(key: string, img: { data: string; mime: 'image/jpeg' | 'image/png' }): Promise<string> {
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  try {
    const r = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });
    if (r.stop_reason === 'refusal') throw new OcrError('Claude no ha querido leer esta imagen');
    return r.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('');
  } catch (e) {
    if (e instanceof OcrError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new OcrError('La clave de Claude no es válida', true);
    if (e instanceof Anthropic.PermissionDeniedError) throw new OcrError('La clave de Claude no tiene permiso para este modelo', true);
    if (e instanceof Anthropic.RateLimitError) throw new OcrError('Claude está saturado o se acabó el saldo; prueba en un momento');
    if (e instanceof Anthropic.APIConnectionError) throw new OcrError('Sin conexión: leer imágenes necesita internet');
    if (e instanceof Anthropic.APIError) throw new OcrError(`Error de Claude (${e.status ?? '?'})`);
    throw e;
  }
}

async function viaGemini(key: string, img: { data: string; mime: string }): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: img.mime, data: img.data } }, { text: PROMPT }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1500 },
      }),
    });
  } catch {
    throw new OcrError('Sin conexión: leer imágenes necesita internet');
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const body = await res.text();
    if (/API key|API_KEY|permission/i.test(body)) throw new OcrError('La clave de Gemini no es válida', true);
    throw new OcrError(`Error de Gemini (${res.status})`);
  }
  if (res.status === 429) throw new OcrError('Has llegado al límite gratuito de Gemini; prueba en un rato');
  if (!res.ok) throw new OcrError(`Error de Gemini (${res.status})`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('');
}

export async function recognize(blob: Blob, cfg: OcrConfig = loadOcr()): Promise<string> {
  const key = (cfg.provider === 'claude' ? cfg.claudeKey : cfg.geminiKey).trim();
  if (!key) {
    throw new OcrError(`Para leer imágenes pon tu clave de ${cfg.provider === 'claude' ? 'Claude' : 'Gemini'} en Ajustes`, true);
  }
  const img = await prepare(blob);
  // límite de tiempo: si la red se queda colgada, la app no debe quedarse «leyendo» para siempre
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new OcrError('La lectura tardó demasiado; inténtalo de nuevo')), 60_000);
  });
  try {
    const text = await Promise.race([cfg.provider === 'claude' ? viaClaude(key, img) : viaGemini(key, img), timeout]);
    return clean(text);
  } finally {
    clearTimeout(timer);
  }
}
