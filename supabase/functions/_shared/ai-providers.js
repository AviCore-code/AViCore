/**
 * AI Provider Router: ChatGPT → Claude → Gemini → JARVIS FTS
 *
 * Usage:
 *   const reply = await aiProviderReply(prompt, systemPrompt, options);
 *
 * Fallback order:
 *   1. ChatGPT (gpt-5.6-sol) via JARVIS-Hermes bridge
 *   2. Claude (claude-haiku-4-5) via JARVIS-Hermes bridge
 *   3. Gemini 3.6 Flash (direct API)
 *   4. JARVIS FTS (knowledge base fallback)
 */

function envValue(name) {
  try {
    return globalThis.Deno?.env?.get(name) || "";
  } catch {
    return "";
  }
}

/**
 * Call JARVIS-Hermes bridge (ChatGPT/Claude).
 */
async function callBridge(model, messages, systemPrompt) {
  const bridgeUrl = envValue("AVICORE_AI_PROXY_URL");
  const bridgeToken = envValue("AVICORE_AI_PROXY_TOKEN");

  if (!bridgeUrl || !bridgeToken) {
    console.warn("[ai-providers] AviCore AI proxy is not configured");
    return null;
  }

  const payload = {
    model,
    messages: systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages,
    temperature: 0.7,
    max_tokens: 2000,
  };

  try {
    const response = await fetch(
      `${bridgeUrl.replace(/\/$/, "")}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${bridgeToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) {
      console.warn(`[ai-providers] bridge returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error("[ai-providers] bridge error:", String(err).slice(0, 200));
    return null;
  }
}

/**
 * Call Gemini 3.6 Flash (direct API).
 */
async function callGemini(prompt, systemPrompt) {
  const apiKey = envValue("GEMINI_API_KEY");
  if (!apiKey) {
    console.warn("[ai-providers] GEMINI_API_KEY not set");
    return null;
  }

  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.warn("[ai-providers] gemini returned", response.status, errText.slice(0, 200));
      return null;
    }

    const data = await response.json();
    return (
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || null
    );
  } catch (err) {
    console.error("[ai-providers] gemini error:", String(err).slice(0, 200));
    return null;
  }
}

/**
 * Main reply function with fallback chain.
 */
export async function aiProviderReply(
  prompt,
  systemPrompt = "",
  options = {}
) {
  const { enableBridge = true, skipGemini = false, timeout = 60000 } = options;

  // Stage 1: Try ChatGPT via bridge
  if (enableBridge) {
    const gptReply = await callBridge("gpt-5.6-sol", [{ role: "user", content: prompt }], systemPrompt);
    if (gptReply) {
      return { reply: gptReply, provider: "chatgpt", tier: "primary" };
    }

    // Stage 2: Try Claude via bridge
    const claudeReply = await callBridge("claude-haiku-4-5-20251001", [{ role: "user", content: prompt }], systemPrompt);
    if (claudeReply) {
      return { reply: claudeReply, provider: "claude", tier: "secondary" };
    }
  }

  // Stage 3: Try Gemini (direct API)
  if (!skipGemini) {
    const geminiReply = await callGemini(prompt, systemPrompt);
    if (geminiReply) {
      return { reply: geminiReply, provider: "gemini", tier: "tertiary" };
    }
  }

  // Stage 4: Return null for JARVIS FTS fallback (caller will handle)
  return null;
}

/**
 * Wrapper for knowledge-based replies (same fallback, with search context).
 */
export async function aiProviderAnswerWithContext(prompt, context, systemPrompt = "") {
  const fullPrompt = context ? `${prompt}\n\nContext:\n${context}` : prompt;
  return aiProviderReply(fullPrompt, systemPrompt, { enableBridge: true, skipGemini: false });
}
