// Intent learning system: track user corrections and improve intent matching
// Stores feedback in admin_intent_feedback table for analysis

const INTENT_ALIASES = {
  // Training/Currency queries
  "training": ["training", "ฝึก", "ฝึกอบรม", "recency", "night", "currency", "currency", "หมดอายุ", "ครบกำหนด", "overdue", "due", "expired"],
  "experience": ["experience", "ประสบการณ์", "hours", "ชั่วโมง", "บิน"],
  "roster": ["roster", "ตารางบิน", "ตารางเวร", "schedule", "duty"],
  "weeklyPlan": ["plan", "แผน", "planning", "week", "สัปดาห์"],
  "duty": ["duty", "ftl", "เวลา", "พัก", "fatigue", "rest"],
  "pilots": ["pilot", "นักบิน", "list", "รายชื่อ", "crew"],
  "overdue": ["overdue", "due", "expired", "หมดอายุ", "ครบ", "ล้าหลัง", "หมด"],
};

const CONFIDENCE_THRESHOLD = 0.6;

// Detect if query is ambiguous (could match multiple intents)
export function detectAmbiguity(query, candidates) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return null; // clear match
  
  // Multiple high-confidence matches = ambiguous
  const highConfidence = candidates.filter(c => c.confidence >= CONFIDENCE_THRESHOLD);
  if (highConfidence.length > 1) {
    return {
      ambiguous: true,
      candidates: highConfidence,
      query,
    };
  }
  return null;
}

// Match query against known intent aliases
export function scoreIntentMatches(query) {
  const text = String(query || "").toLowerCase().trim();
  const words = text.split(/\s+/);
  const scores = {};
  
  for (const [intent, aliases] of Object.entries(INTENT_ALIASES)) {
    let matches = 0;
    for (const alias of aliases) {
      if (text.includes(alias.toLowerCase())) matches++;
    }
    // Use: (matches / number of words in query) for better short-query scoring
    // So "training" (1 word, 1 match) scores 1.0, not 0.08
    scores[intent] = matches > 0 ? Math.min(matches / words.length, 1) : 0;
  }
  
  return Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([intent, score]) => ({ intent, confidence: score }));
}

// Generate clarification prompt for ambiguous queries
export function generateClarificationPrompt(ambiguity) {
  if (!ambiguity || !ambiguity.ambiguous) return null;
  
  const intentLabels = {
    training: "📚 Training/Currency (recency, expiry, due)",
    experience: "✈️ Experience (flight hours, licenses)",
    roster: "📋 Flight Roster (schedule, duty roster)",
    weeklyPlan: "📅 Weekly Plans (training schedule)",
    duty: "⏱️ Duty/FTL (rest, fatigue, time tracking)",
    pilots: "👥 Pilot List (crew information)",
    overdue: "⚠️ Overdue/Expired (who's due for training)",
  };
  
  const options = ambiguity.candidates
    .slice(0, 3)
    .map((c, i) => `${i + 1}. ${intentLabels[c.intent] || c.intent}`)
    .join("\n");
  
  return `ผมไม่แน่ใจว่าคุณต้องการข้อมูลเรื่องอะไร กรุณาเลือก:\n${options}\n\nตัวอย่าง: "1" หรือ "training" ครับ`;
}

// Log feedback to database for learning
export async function logIntentFeedback(sb, companyId, {
  query,
  userQuery,
  classifiedIntent,
  correctedIntent,
  confidence,
  feedback, // "correct", "wrong", "clarified"
}) {
  if (!sb || !companyId) return null;
  
  try {
    const { error } = await sb
      .from("admin_intent_feedback")
      .insert([{
        company_id: companyId,
        user_query: String(userQuery || "").slice(0, 500),
        classified_intent: classifiedIntent,
        corrected_intent: correctedIntent,
        confidence: parseFloat(confidence) || 0,
        feedback_type: feedback, // "correct" | "wrong" | "clarified"
        created_at: new Date().toISOString(),
      }]);
    
    if (error) console.error("[intent-learning] feedback log failed", error);
    return !error;
  } catch (err) {
    console.error("[intent-learning] exception", err);
    return false;
  }
}

// Detect short/vague queries that might need clarification
export function isVagueQuery(query) {
  const text = String(query || "").trim();
  const words = text.split(/\s+/).length;
  
  // Very short (1-2 words) AND no clear intent keyword
  if (words <= 2) {
    const scores = scoreIntentMatches(query);
    // If no matches at all, or very low confidence, consider it vague
    if (!scores.length || scores[0].confidence < 0.5) return true;
  }
  
  return false;
}

// Build learning-aware response
export async function buildIntentResponse({
  query,
  primaryIntent,
  confidence,
  ambiguity = null,
  response = null,
  sb = null,
  companyId = null,
}) {
  // If ambiguous, ask for clarification
  if (ambiguity?.ambiguous) {
    const clarifyPrompt = generateClarificationPrompt(ambiguity);
    // Log the ambiguity event
    if (sb && companyId) {
      logIntentFeedback(sb, companyId, {
        userQuery: query,
        classifiedIntent: primaryIntent,
        confidence,
        feedback: "clarified",
      }).catch(() => {});
    }
    return clarifyPrompt;
  }
  
  // If low confidence on vague query, ask for clarification
  if (isVagueQuery(query) && confidence < CONFIDENCE_THRESHOLD) {
    const suggestions = scoreIntentMatches(query)
      .slice(0, 3)
      .map(c => c.intent)
      .join(" / ");
    const prompt = `คำถามสั้นเกินไป 😊 ขอบ context หนึ่งได้ไหม เช่น:\n• Training/Currency ใครหมดอายุ\n• Flight Hours ของนักบิน\n• ตารางบิน วันนี้\n• แผนรายสัปดาห์\n\nหรือบอก "ช่วยเหลือ" ครับ`;
    
    if (sb && companyId) {
      logIntentFeedback(sb, companyId, {
        userQuery: query,
        classifiedIntent: primaryIntent,
        confidence,
        feedback: "vague",
      }).catch(() => {});
    }
    return prompt;
  }
  
  // Log successful classification
  if (sb && companyId) {
    logIntentFeedback(sb, companyId, {
      userQuery: query,
      classifiedIntent: primaryIntent,
      confidence,
      feedback: response ? "correct" : "no_match",
    }).catch(() => {});
  }
  
  return response;
}

export const INTENT_LEARNING_NOTE = `💡 หมายเหตุ: ผมเก็บคำถามของคุณเพื่อเรียนรู้และปรับปรุง AI Bot ครับ`;
