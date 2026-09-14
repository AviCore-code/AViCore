import { useEffect, useRef, useState } from "react";
import { getSetting, saveSetting } from "../../services/desktopDatabase.js";
import { askAssistant, detectLanguage } from "./weeklyPlanAssistant.js";
import { voiceSupport, startListening, speak, stopSpeaking, ensureVoices, listVoices, hasVoiceFor } from "./weeklyPlanVoice.js";
import { AI_SETTING_KEY, AI_PROVIDERS, withAiDefaults, aiConfigProblem, askAi } from "./weeklyPlanAi.js";
import "./PilotRoster.css";

// The assistant panel.
//
// Two answerers, in order:
//   1. The DETERMINISTIC assistant. It reads the live plan and answers facts
//      and runs commands. Instant, free, and it cannot be wrong about a duty
//      limit because it computes from the same code the planner uses.
//   2. If that has no intent for the question AND a model is configured, the
//      question goes to ChatGPT or Gemini with the plan as context. Those
//      answers are labelled, because they carry a different level of trust.
//
// Order matters: anything safety-relevant is answered by (1). The model is
// for the open-ended "what should I be watching next week" questions.

function renderMarkdownish(text) {
  // Just bold and bullets - enough for the assistant's own output, without
  // pulling in a markdown library for a chat box.
  return String(text || "").split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**")
        ? <b key={j}>{p.slice(2, -2)}</b>
        : <span key={j}>{p}</span>
    );
    return <div key={i} className={line.startsWith("·") ? "wchat-bullet" : ""}>{parts}</div>;
  });
}

export default function WeeklyPlanChat({ context, onActions, onClose }) {
  const [messages, setMessages] = useState([{
    from: "bot",
    text: "Ask me about the plan, or tell me to change it. Type **help** to see what I can do."
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiConfig, setAiConfig] = useState(null);
  const [showSetup, setShowSetup] = useState(false);
  // Voice mode: hold-to-talk in, spoken answers out. ON by default - this was
  // asked for as "voice mode", and shipping it defaulted off behind a small
  // button meant it looked broken rather than switched off.
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceNote, setVoiceNote] = useState(null);
  // Tracked separately from the note because it changes BEHAVIOUR, not just
  // wording: with no Thai voice, a Thai answer must be spoken in English or
  // not at all — an English voice silently drops every Thai character.
  const [langVoiceMissing, setLangVoiceMissing] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [voiceLang, setVoiceLang] = useState("th");
  const stopListenRef = useRef(null);
  const endRef = useRef(null);
  const support = voiceSupport();

  useEffect(() => {
    getSetting(AI_SETTING_KEY).then((c) => setAiConfig(withAiDefaults(c))).catch(() => setAiConfig(withAiDefaults(null)));
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);

  // Voices load asynchronously; check what's actually installed once they're
  // in, so the panel can say "no Thai voice on this machine" instead of just
  // being silent.
  useEffect(() => {
    let cancelled = false;
    ensureVoices().then(() => {
      if (cancelled) return;
      const missing = !hasVoiceFor(voiceLang);
      setLangVoiceMissing(missing);
      if (!listVoices().length) {
        setVoiceNote("This machine has no speech voices installed, so answers can't be read aloud.");
      } else if (missing) {
        setVoiceNote(voiceLang === "th"
          ? "เครื่องนี้ไม่มีเสียงภาษาไทย — คำตอบภาษาไทยจะถูกอ่านออกเสียงเป็นภาษาอังกฤษแทน (เสียงอังกฤษอ่านตัวอักษรไทยไม่ได้ จะข้ามทั้งหมด) ติดตั้งเสียงไทย: Windows Settings → Time & language → Speech → Add voices → Thai แล้วรีเฟรชหน้านี้"
          : "No English voice installed — using whatever the browser provides.");
      } else {
        setVoiceNote(null);
      }
    });
    return () => { cancelled = true; };
  }, [voiceLang]);

  // Stop any speech when the panel closes - nothing worse than a page that
  // keeps talking after you've shut it.
  useEffect(() => () => { stopSpeaking(); stopListenRef.current?.(); }, []);

  function reply(from, text, lang, fallbackText) {
    setMessages((m) => [...m, { from, text }]);
    if (voiceOn && support.canSpeak) {
      speak(text, lang, { fallbackText, onError: (err) => setVoiceNote(err.message) });
    }
  }

  function toggleListening() {
    if (listening) {
      stopListenRef.current?.();
      setListening(false);
      return;
    }
    stopSpeaking();
    setHeard("");
    setListening(true);
    stopListenRef.current = startListening({
      lang: voiceLang,
      onPartial: setHeard,
      onResult: (text) => { setListening(false); setHeard(""); send(text); },
      onError: (err) => {
        setListening(false);
        setHeard("");
        setMessages((m) => [...m, { from: "bot", text: err.message }]);
      }
    });
  }

  async function send(question) {
    const q = question.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { from: "user", text: q }]);
    setInput("");

    const local = askAssistant(q, context);
    const lang = local.lang || detectLanguage(q);

    // Only re-render in English when it will actually be needed for speech:
    // a Thai answer on a machine with no Thai voice.
    const needFallback = voiceOn && langVoiceMissing && lang === "th";
    const spokenFallback = needFallback ? askAssistant(q, context, { forceLang: "en" }).text : undefined;

    if (!local.unknown) {
      reply("bot", local.text, lang, spokenFallback);
      if (local.actions?.length) onActions?.(local.actions);
      return;
    }

    // Not something the deterministic assistant knows. Hand it to the model
    // if one is configured; otherwise say so honestly.
    if (aiConfigProblem(aiConfig)) {
      reply("bot", local.text, lang, spokenFallback);
      return;
    }

    setBusy(true);
    try {
      const answer = await askAi({ config: aiConfig, contextText: context.summarise(), question: q });
      reply("ai", answer, lang);
    } catch (err) {
      reply("bot", lang === "th" ? `ติดต่อ AI ไม่ได้: ${err.message}` : `Couldn't reach the AI: ${err.message}`, lang);
    } finally {
      setBusy(false);
    }
  }

  async function saveAi(next) {
    setAiConfig(next);
    try { await saveSetting(AI_SETTING_KEY, next); } catch { /* surfaced on next use */ }
  }

  const aiReady = aiConfig && !aiConfigProblem(aiConfig);

  return (
    <div className="wchat">
      <div className="wchat-head">
        <div>
          <b>Schedule Assistant</b>
          <span className={`wchat-badge${aiReady ? " on" : ""}`}>
            {aiReady ? `AI: ${aiConfig.provider}` : "local only"}
          </span>
        </div>
        <div className="wchat-head-actions">
          {support.canSpeak && (
            <button
              className={voiceOn ? "wchat-voice-on" : ""}
              onClick={() => { const next = !voiceOn; setVoiceOn(next); if (!next) stopSpeaking(); }}
              title={voiceOn ? "Spoken answers are on" : "Speak the answers aloud"}
            >
              {voiceOn ? "🔊 Voice on" : "🔈 Voice off"}
            </button>
          )}
          {support.canSpeak && (
            <button
              onClick={() => speak(
                voiceLang === "th" ? "ทดสอบเสียง ผมพูดภาษาไทยได้ครับ" : "Voice test. I can read the answers aloud.",
                voiceLang,
                {
                  fallbackText: "Voice test. There is no Thai voice on this machine, so answers are read out in English.",
                  onError: (err) => setVoiceNote(err.message)
                }
              )}
              title="Play a test phrase"
            >🔉 Test</button>
          )}
          <select className="wchat-lang" value={voiceLang} onChange={(e) => setVoiceLang(e.target.value)} title="Language for the microphone">
            <option value="th">ไทย</option>
            <option value="en">EN</option>
          </select>
          <button onClick={() => setShowSetup((v) => !v)}>{showSetup ? "Close setup" : "AI setup"}</button>
          <button onClick={onClose}>✕</button>
        </div>
      </div>

      {voiceNote && (
        <div className="wchat-voicenote">
          ⚠ {voiceNote}
          <button onClick={() => setVoiceNote(null)} title="Dismiss">✕</button>
        </div>
      )}

      {showSetup && aiConfig && (
        <div className="wchat-setup">
          <label className="wchat-toggle">
            <input type="checkbox" checked={aiConfig.enabled}
              onChange={(e) => saveAi({ ...aiConfig, enabled: e.target.checked })} />
            <span>Send unmatched questions to a language model</span>
          </label>

          <label className="wchat-field">
            <span>Provider</span>
            <select value={aiConfig.provider} onChange={(e) => saveAi({ ...aiConfig, provider: e.target.value })}>
              {AI_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>

          {aiConfig.provider === "proxy" ? (
            <label className="wchat-field">
              <span>Proxy URL</span>
              <input lang="en" value={aiConfig.proxyUrl} placeholder="https://<project>.supabase.co/functions/v1/ai-chat"
                onChange={(e) => saveAi({ ...aiConfig, proxyUrl: e.target.value })} />
            </label>
          ) : (
            <>
              <label className="wchat-field">
                <span>API key</span>
                <input type="password" lang="en" value={aiConfig.apiKey} placeholder="sk-… / AIza…"
                  onChange={(e) => saveAi({ ...aiConfig, apiKey: e.target.value })} />
              </label>
              <label className="wchat-field">
                <span>Model <small>(optional)</small></span>
                <input lang="en" value={aiConfig.model} placeholder={aiConfig.provider === "openai" ? "gpt-4o-mini" : "gemini-1.5-flash"}
                  onChange={(e) => saveAi({ ...aiConfig, model: e.target.value })} />
              </label>
              <div className="wchat-warn">
                ⚠ A key entered here is downloaded to every admin’s browser and can be read from the
                network tab — it is <b>not secret</b>, and usage is chargeable to you. For anything
                beyond trying it out, use the <b>server proxy</b> option instead so the key never
                leaves your server.
              </div>
            </>
          )}

          <div className="wchat-note">
            Facts and commands are always answered by the app itself, from the real plan.
            The model only sees questions the app has no answer for, and is told to
            answer only from the plan it is given — but it can still be wrong, so check
            anything about limits against FDT Monitor.
          </div>
        </div>
      )}

      <div className="wchat-log">
        {messages.map((m, i) => (
          <div key={i} className={`wchat-msg wchat-${m.from}`}>
            {m.from === "ai" && <div className="wchat-ai-tag">AI answer — verify against FDT Monitor</div>}
            {renderMarkdownish(m.text)}
          </div>
        ))}
        {busy && <div className="wchat-msg wchat-bot wchat-typing">Thinking…</div>}
        <div ref={endRef} />
      </div>

      {listening && (
        <div className="wchat-listening">
          <span className="wchat-dot" /> {heard || (voiceLang === "th" ? "กำลังฟัง…" : "Listening…")}
        </div>
      )}

      <form className="wchat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        {support.canListen ? (
          <button
            type="button"
            className={`wchat-mic${listening ? " on" : ""}`}
            onClick={toggleListening}
            title={listening ? "Stop listening" : "Ask by voice"}
          >
            {listening ? "◼" : "🎤"}
          </button>
        ) : (
          <button type="button" className="wchat-mic" disabled title={support.reason}>🎤</button>
        )}
        <input
          value={input}
          placeholder={voiceLang === "th"
            ? "เช่น ใครว่างวันศุกร์ · ทำไม CSU ไม่ถูกจัด · ย้าย WJU ไป Crew 2 วันพุธ"
            : "e.g. who is free on Friday · why isn't CSU planned · put WJU on Crew 2 Wednesday"}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="primary" type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </div>
  );
}
