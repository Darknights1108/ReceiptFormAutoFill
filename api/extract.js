const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    merchantName: {
      type: "string",
      description: "Merchant or store name printed on the receipt. Empty string if not visible."
    },
    date: {
      type: "string",
      description: "Receipt transaction date in YYYY-MM-DD format when possible. Empty string if not visible."
    },
    totalAmount: {
      type: "string",
      description: "Final amount paid, using a period as the decimal separator and no currency symbols."
    },
    currency: {
      type: "string",
      description: "ISO 4217 currency code such as USD, MYR, EUR, or a visible currency symbol if the code is unclear."
    },
    confidence: {
      type: "object",
      properties: {
        merchantName: { type: "number", description: "Confidence from 0 to 1." },
        date: { type: "number", description: "Confidence from 0 to 1." },
        totalAmount: { type: "number", description: "Confidence from 0 to 1." },
        currency: { type: "number", description: "Confidence from 0 to 1." }
      },
      required: ["merchantName", "date", "totalAmount", "currency"],
      additionalProperties: false
    },
    notes: {
      type: "string",
      description: "Brief note about ambiguity, damaged text, or assumptions. Empty string if none."
    }
  },
  required: ["merchantName", "date", "totalAmount", "currency", "confidence", "notes"],
  additionalProperties: false
};

const EXTRACTION_PROMPT = `Extract the key receipt fields for an expense form.

Rules:
- Return only the structured JSON requested by the schema.
- Merchant name should be the business/store name, not the payment provider.
- Date should be the purchase or transaction date. Prefer YYYY-MM-DD.
- Total amount should be the final grand total paid, not subtotal, tax, balance, cash, or change.
- Currency should be an ISO 4217 code when clear from the receipt locale or symbol.
- Use empty strings for fields that are not visible.
- Add a short notes value only when there is meaningful uncertainty.`;

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body) {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }

  let body = "";
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Uploaded image is too large. Try a smaller or more compressed image.");
      error.statusCode = 413;
      throw error;
    }
    body += chunk;
  }

  if (!body) {
    return {};
  }

  return JSON.parse(body);
}

function extractOutputText(responsePayload) {
  if (typeof responsePayload.output_text === "string") {
    return responsePayload.output_text;
  }

  const chunks = [];
  for (const outputItem of responsePayload.output ?? []) {
    for (const contentItem of outputItem.content ?? []) {
      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        chunks.push(contentItem.text);
      }
    }
  }

  return chunks.join("\n");
}

function validateImageDataUrl(image) {
  if (typeof image !== "string") {
    return false;
  }

  return /^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\r\n]+$/i.test(image);
}

function getAiConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY || process.env.AI_API_KEY,
    baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || DEFAULT_BASE_URL),
    model: process.env.OPENAI_MODEL || process.env.AI_MODEL || DEFAULT_MODEL,
    mode: (process.env.OPENAI_API_MODE || process.env.AI_API_MODE || "auto").toLowerCase()
  };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function getModeOrder({ baseUrl, mode }) {
  if (mode === "responses") {
    return ["responses"];
  }

  if (mode === "chat") {
    return ["chat"];
  }

  const isOfficialOpenAi = baseUrl.includes("api.openai.com");
  return isOfficialOpenAi ? ["responses", "chat"] : ["chat", "responses"];
}

async function postJson(url, apiKey, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload.error?.message || payload.message || "AI extraction request failed.";
    const error = new Error(message);
    error.statusCode = response.status;
    error.responsePayload = payload;
    throw error;
  }

  return payload;
}

function buildReceiptPrompt() {
  return `${EXTRACTION_PROMPT}

Return a JSON object with this exact shape:
{
  "merchantName": "string",
  "date": "YYYY-MM-DD or empty string",
  "totalAmount": "string",
  "currency": "ISO 4217 code or visible symbol",
  "confidence": {
    "merchantName": 0,
    "date": 0,
    "totalAmount": 0,
    "currency": 0
  },
  "notes": "string"
}`;
}

async function extractWithResponses({ apiKey, baseUrl, model, image }) {
  const payload = await postJson(`${baseUrl}/responses`, apiKey, {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You extract receipt data for a user-reviewed expense form. Be precise and conservative."
          }
        ]
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: EXTRACTION_PROMPT },
          { type: "input_image", image_url: image, detail: "high" }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "receipt_fields",
        strict: true,
        schema: RECEIPT_SCHEMA
      }
    }
  });

  return parseModelJson(extractOutputText(payload));
}

async function extractWithChatCompletions({ apiKey, baseUrl, model, image }) {
  const buildBody = ({ useJsonMode, includeDetail }) => ({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "You extract receipt data for a user-reviewed expense form. Return JSON only."
      },
      {
        role: "user",
        content: [
          { type: "text", text: buildReceiptPrompt() },
          {
            type: "image_url",
            image_url: includeDetail ? { url: image, detail: "high" } : { url: image }
          }
        ]
      }
    ],
    ...(useJsonMode ? { response_format: { type: "json_object" } } : {})
  });

  const attempts = [
    { useJsonMode: true, includeDetail: true },
    { useJsonMode: false, includeDetail: true },
    { useJsonMode: false, includeDetail: false }
  ];
  let lastError;
  let payload;

  for (const attempt of attempts) {
    try {
      payload = await postJson(`${baseUrl}/chat/completions`, apiKey, buildBody(attempt));
      break;
    } catch (error) {
      lastError = error;
      if (![400, 404, 422].includes(error.statusCode)) {
        throw error;
      }
    }
  }

  if (!payload) {
    throw lastError;
  }

  const content = payload.choices?.[0]?.message?.content;
  const outputText = Array.isArray(content)
    ? content.map((item) => item.text || "").join("\n")
    : content;

  return parseModelJson(outputText);
}

function parseModelJson(outputText) {
  if (!outputText) {
    const error = new Error("The model returned no parseable text.");
    error.statusCode = 502;
    throw error;
  }

  const trimmed = String(outputText).trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  const jsonText = start >= 0 && end >= start ? withoutFence.slice(start, end + 1) : withoutFence;
  return normalizeReceiptFields(JSON.parse(jsonText));
}

function normalizeReceiptFields(fields) {
  const confidence = fields.confidence || {};
  return {
    merchantName: toStringField(fields.merchantName),
    date: toStringField(fields.date),
    totalAmount: toStringField(fields.totalAmount),
    currency: toStringField(fields.currency).toUpperCase(),
    confidence: {
      merchantName: toConfidence(confidence.merchantName),
      date: toConfidence(confidence.date),
      totalAmount: toConfidence(confidence.totalAmount),
      currency: toConfidence(confidence.currency)
    },
    notes: toStringField(fields.notes)
  };
}

function toStringField(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function toConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numeric));
}

async function extractReceiptFields(image) {
  const config = getAiConfig();

  if (!config.apiKey) {
    const error = new Error("Missing OPENAI_API_KEY. Add it to .env locally or to Vercel environment variables.");
    error.statusCode = 500;
    throw error;
  }

  const attempts = [];

  for (const mode of getModeOrder(config)) {
    try {
      const fields =
        mode === "responses"
          ? await extractWithResponses({ ...config, image })
          : await extractWithChatCompletions({ ...config, image });

      return {
        fields,
        model: config.model,
        apiMode: mode,
        prompt: buildReceiptPrompt()
      };
    } catch (error) {
      attempts.push(`${mode}: ${error.message}`);
    }
  }

  const error = new Error(attempts.join(" | ") || "AI extraction request failed.");
  error.statusCode = 502;
  throw error;
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed. Use POST." });
    return;
  }

  try {
    const body = await readJsonBody(req);

    if (!validateImageDataUrl(body.image)) {
      sendJson(res, 400, { error: "Expected a base64 data URL for a PNG, JPG, JPEG, or WEBP receipt image." });
      return;
    }

    const result = await extractReceiptFields(body.image);
    sendJson(res, 200, result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, { error: error.message || "Unexpected extraction error." });
  }
}

export { EXTRACTION_PROMPT, RECEIPT_SCHEMA };
