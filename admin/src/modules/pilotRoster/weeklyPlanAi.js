// Optional language-model back-end for the Weekly Schedule assistant.
//
// The assistant answers factual questions and runs commands itself, from the
// real data (weeklyPlanAssistant.js). This module is the fallback for
// open-ended questions it doesn't have an intent for - "what should I watch
// out for next week?", "explain why this week is short-handed".
//
// TWO THINGS TO BE CLEAR ABOUT
//
// 1. AN API KEY IN A BROWSER IS NOT SECRET. This build is a static site; a
//    key stored in settings is downloaded to every admin's browser and can be
//    read out of the network tab. That may be acceptable for an internal tool
//    behind an admin login, but it is not "secure", and a leaked key is
//    chargeable to you. The PROXY option exists for that reason: put the key
//    in a Supabase Edge Function (or any small server endpoint) and point
//    this at it, and the key never reaches the browser at all.
//
// 2. THE MODEL DOES NOT KNOW YOUR RULES. It is given the current plan and a
//    summary of the rules as context, and told to answer only from that and
//    to say when it doesn't know. It can still be wrong. Anything it says
//    about duty limits should be checked against FDT Monitor - which is
//    exactly what the deterministic assistant is for.

export const AI_SETTING_KEY = "weekly_plan_ai";

export const AI_PROVIDERS = [
  { id: "proxy", label: "Server proxy (recommended — key stays off the browser)" },
  { id: "openai", label: "OpenAI / ChatGPT" },
  { id: "gemini", label: "Google Gemini" }
];

export const DEFAULT_AI_CONFIG = {
  enabled: false,
  provider: "proxy",
  proxyUrl: "",
  apiKey: "",
  model: ""
};

const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  gemini: "gemini-1.5-flash"
};

export function withAiDefaults(saved) {
  return { ...DEFAULT_AI_CONFIG, ...(saved || {}) };
}

export function aiConfigProblem(config) {
  const c = withAiDefaults(config);
  if (!c.enabled) return "AI answers are turned off.";
  if (c.provider === "proxy" && !c.proxyUrl) return "No proxy URL set.";
  if (c.provider !== "proxy" && !c.apiKey) return "No API key set.";
  return null;
}

// The instruction the model runs under. Deliberately narrow: it is a reader
// of the supplied context, not an authority on flight time limitations.
export function buildSystemPrompt(contextText) {
  return [
    // No operator named. AviCore is sold to other companies, and telling the
    // model it works for one of them would put that name in answers read by a
    // different customer's chief pilot.
    "You are an assistant inside AviCore, a flight-and-duty-time application used by a helicopter operator. You are helping the chief pilot plan next week's crewing.",
    "",
    "RULES FOR YOUR ANSWERS:",
    "1. Answer ONLY from the CONTEXT below. It is the live plan and the operator's own rules.",
    "2. If the context doesn't contain the answer, say so plainly and suggest what to look at. Never guess a duty limit, a pilot's hours, or whether someone is legal to fly.",
    "3. Never invent a regulation. If asked about a rule not in the context, say it isn't in what you've been given.",
    "4. Be brief. The reader is an experienced pilot - no preamble, no restating the question.",
    "5. Reply in the language the question was asked in (Thai or English).",
    "6. You cannot change the schedule. If asked to, say the user should use a command like \"put WJU on Crew 2 on Wednesday\", which the app executes directly.",
    "",
    "CONTEXT",
    contextText
  ].join("\n");
}

async function callOpenAi({ apiKey, model, system, question }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.openai,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: question }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "(no answer)";
}

async function callGemini({ apiKey, model, system, question }) {
  const name = model || DEFAULT_MODELS.gemini;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: question }] }],
        generationConfig: { temperature: 0.2 }
      })
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim() || "(no answer)";
}

// The proxy contract is deliberately trivial so it can be a ten-line Supabase
// Edge Function: POST { system, question } -> { text }.
async function callProxy({ proxyUrl, system, question }) {
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, question })
  });
  if (!res.ok) throw new Error(`Proxy ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json().catch(() => ({}));
  return data.text || data.answer || "(no answer)";
}

export async function askAi({ config, contextText, question }) {
  const c = withAiDefaults(config);
  const problem = aiConfigProblem(c);
  if (problem) throw new Error(problem);

  const system = buildSystemPrompt(contextText);
  if (c.provider === "openai") return callOpenAi({ ...c, system, question });
  if (c.provider === "gemini") return callGemini({ ...c, system, question });
  return callProxy({ ...c, system, question });
}
