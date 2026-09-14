// Voice for the Schedule Assistant: speak a question, hear the answer.
//
// Uses the browser's built-in Web Speech API - no service, no key, no cost,
// and nothing leaves the machine for the speech-to-text on most browsers.
// Chrome and Edge support both halves; Firefox has no recognition, which is
// detected rather than assumed.
//
// Thai is supported by both halves (th-TH), which is the whole reason this is
// worth having here: the chief pilot can ask "ใครว่างวันศุกร์" hands-free
// while looking at the grid.

export const VOICE_LANGS = {
  th: "th-TH",
  en: "en-US"
};

function Recognition() {
  return typeof window !== "undefined"
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
}

export function voiceSupport() {
  const canListen = !!Recognition();
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  return {
    canListen,
    canSpeak,
    // Said plainly so the UI can explain rather than just disable a button.
    reason: canListen
      ? null
      : "This browser can't do speech recognition — Chrome or Edge can. Typing still works."
  };
}

// Strips the assistant's light markdown so it isn't read out as "star star".
export function speakableText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/^·\s*/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Browsers load the voice list ASYNCHRONOUSLY. getVoices() returns [] on the
// first call in Chrome, and only fills in after a "voiceschanged" event. This
// is the single most common reason speech "doesn't work": the code asks for a
// voice, gets nothing, and either picks none or silently fails.
let voicesReady = null;

export function ensureVoices(timeoutMs = 2000) {
  if (typeof speechSynthesis === "undefined") return Promise.resolve([]);
  if (voicesReady) return voicesReady;

  voicesReady = new Promise((resolve) => {
    const existing = speechSynthesis.getVoices();
    if (existing && existing.length) return resolve(existing);

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      speechSynthesis.removeEventListener?.("voiceschanged", done);
      resolve(speechSynthesis.getVoices() || []);
    };
    speechSynthesis.addEventListener?.("voiceschanged", done);
    // Some browsers never fire the event if the list is already warm.
    setTimeout(done, timeoutMs);
  });
  return voicesReady;
}

export function listVoices() {
  if (typeof speechSynthesis === "undefined") return [];
  return speechSynthesis.getVoices() || [];
}

// Does a voice exist for this language? Answered honestly, because a missing
// Thai voice is the difference between "speaks with an accent" and "says
// nothing at all", and the user needs to be told which.
export function hasVoiceFor(lang) {
  const wanted = VOICE_LANGS[lang] || VOICE_LANGS.en;
  const base = wanted.split("-")[0];
  return listVoices().some((v) => v.lang === wanted || v.lang?.startsWith(base));
}

function pickVoice(lang, voices) {
  const wanted = VOICE_LANGS[lang] || VOICE_LANGS.en;
  const base = wanted.split("-")[0];
  return voices.find((v) => v.lang === wanted)
    || voices.find((v) => v.lang?.replace("_", "-") === wanted)
    || voices.find((v) => v.lang?.startsWith(base))
    || null;
}

// Chrome stops speaking after ~15s unless it is nudged, and can also get
// stuck in a paused state after a previous cancel(). Both are long-standing
// browser bugs, not something the caller can avoid.
function keepAlive(utterance) {
  if (typeof speechSynthesis === "undefined") return;
  const timer = setInterval(() => {
    if (!speechSynthesis.speaking) return clearInterval(timer);
    speechSynthesis.pause();
    speechSynthesis.resume();
  }, 10000);
  const stop = () => clearInterval(timer);
  utterance.addEventListener?.("end", stop);
  utterance.addEventListener?.("error", stop);
}

// An English voice handed Thai text does NOT mispronounce it - it SKIPS it.
// The engine drops every character it has no phoneme for, so a Thai answer
// containing one Latin word comes out as that single word and nothing else.
// That is worse than silence: it sounds like the app answered when it didn't.
// So a missing voice is treated as a hard stop, and the caller is offered a
// fallbackText (the same answer in a language a voice does exist for).
export async function speak(text, lang = "en", { rate = 1, onEnd, onError, fallbackText, fallbackLang = "en" } = {}) {
  if (typeof speechSynthesis === "undefined") {
    onError?.(new Error("This browser can't speak."));
    return null;
  }
  let spoken = speakableText(text);
  if (!spoken) return null;

  const voices = await ensureVoices();

  let useLang = lang;
  let voice = pickVoice(lang, voices);

  if (!voice) {
    const alt = fallbackText ? pickVoice(fallbackLang, voices) : null;
    if (alt) {
      // Say the same thing in a language this machine can actually speak.
      spoken = speakableText(fallbackText);
      useLang = fallbackLang;
      voice = alt;
      onError?.(new Error(
        lang === "th"
          ? "เครื่องนี้ไม่มีเสียงภาษาไทย — อ่านคำตอบเป็นภาษาอังกฤษแทน ติดตั้งเสียงไทยที่ Windows Settings → Time & language → Speech → Add voices → Thai แล้วรีเฟรช"
          : `No ${VOICE_LANGS[lang]} voice installed — read out in ${VOICE_LANGS[fallbackLang]} instead.`
      ));
    } else {
      // Nothing usable. Say nothing rather than emit a few stray syllables.
      onError?.(new Error(
        lang === "th"
          ? "เครื่องนี้ไม่มีเสียงภาษาไทย จึงอ่านคำตอบภาษาไทยไม่ได้ (เสียงอังกฤษจะข้ามตัวอักษรไทยทั้งหมด) ติดตั้งที่ Windows Settings → Time & language → Speech → Add voices → Thai แล้วรีเฟรชหน้านี้"
          : `No ${VOICE_LANGS[lang]} voice is installed on this machine, so the answer can't be read aloud.`
      ));
      return null;
    }
  }

  speechSynthesis.cancel();      // never let two answers talk over each other
  speechSynthesis.resume();      // clear a stuck paused state from a previous cancel

  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.voice = voice;
  utterance.lang = voice.lang || VOICE_LANGS[useLang];
  utterance.rate = rate;
  if (onEnd) utterance.onend = onEnd;
  utterance.onerror = (e) => {
    // "interrupted" and "canceled" are normal when a new answer arrives.
    if (e.error === "interrupted" || e.error === "canceled") return;
    onError?.(new Error(`Speech failed: ${e.error}`));
  };

  keepAlive(utterance);
  speechSynthesis.speak(utterance);
  return utterance;
}

export function stopSpeaking() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

// One-shot listen. Resolves with the transcript, or rejects with a message
// already worded for the user.
export function listenOnce({ lang = "en", onPartial } = {}) {
  const Ctor = Recognition();
  if (!Ctor) return Promise.reject(new Error(voiceSupport().reason));

  return new Promise((resolve, reject) => {
    const recognition = new Ctor();
    recognition.lang = VOICE_LANGS[lang] || VOICE_LANGS.en;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    let finalText = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      onPartial?.(finalText || interim);
    };

    recognition.onerror = (event) => {
      const messages = {
        "not-allowed": "Microphone permission was refused. Allow it in the browser's address bar and try again.",
        "no-speech": "I didn't hear anything.",
        "audio-capture": "No microphone found.",
        network: "Speech recognition needs a network connection."
      };
      reject(new Error(messages[event.error] || `Speech recognition failed: ${event.error}`));
    };

    recognition.onend = () => {
      if (finalText.trim()) resolve(finalText.trim());
      else reject(new Error("I didn't catch that."));
    };

    try {
      recognition.start();
    } catch (err) {
      reject(new Error(`Couldn't start the microphone: ${err.message}`));
    }

    // Handed back so the caller can stop it early.
    resolve.recognition = recognition;
  });
}

// Convenience wrapper that also exposes a stop handle, which listenOnce
// can't return directly from a Promise.
export function startListening({ lang = "en", onPartial, onResult, onError } = {}) {
  const Ctor = Recognition();
  if (!Ctor) {
    onError?.(new Error(voiceSupport().reason));
    return () => {};
  }

  const recognition = new Ctor();
  recognition.lang = VOICE_LANGS[lang] || VOICE_LANGS.en;
  recognition.interimResults = true;
  recognition.continuous = false;

  let finalText = "";

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onPartial?.(finalText || interim);
  };
  recognition.onerror = (event) => {
    const messages = {
      "not-allowed": "Microphone permission was refused — allow it in the address bar and try again.",
      "no-speech": "I didn't hear anything.",
      "audio-capture": "No microphone found.",
      network: "Speech recognition needs a network connection."
    };
    onError?.(new Error(messages[event.error] || `Speech recognition failed: ${event.error}`));
  };
  recognition.onend = () => {
    if (finalText.trim()) onResult?.(finalText.trim());
    else onError?.(new Error("I didn't catch that."));
  };

  try { recognition.start(); } catch (err) { onError?.(err); }
  return () => { try { recognition.stop(); } catch { /* already stopped */ } };
}
