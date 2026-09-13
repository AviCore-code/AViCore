export const KNOWLEDGE_NOTE = "หมายเหตุ: โปรดตรวจสอบข้อมูลและเอกสารฉบับล่าสุดในระบบ Company Database (IQSMS) อีกครั้งก่อนนำไปใช้งาน";
const aliases = [
 ["เชื้อเพลิงสำรอง", "reserve fuel"], ["min vis", "minimum visibility"], ["minimum vis", "minimum visibility"], ["visibility", "visibility"], ["vis", "visibility"], ["take off", "take-off"], ["takeoff", "take-off"], ["off shore", "offshore"], ["ลม", "wind"], ["90d", "90 day"], ["90 วัน", "90 day"], ["180d", "180 day"], ["180 วัน", "180 day"], ["น้ำมันสำรอง", "reserve fuel"],
 ["เวลาบิน", "flight time limitations"], ["ชั่วโมงบิน", "flight time limitations"],
 ["เวลาพัก", "rest period"], ["ความเหนื่อยล้า", "fatigue"],
 ["วัตถุอันตราย", "dangerous goods"], ["สินค้าอันตราย", "dangerous goods"],
 ["เชื้อเพลิง", "fuel"], ["สนามบินสำรอง", "alternate aerodrome"],
 ["จำกัดลม", "wind limit"], ["ลมแรง", "wind limit"], ["ห้ามติดเครื่องยนต์", "engine start wind limit"], ["ติดเครื่องยนต์", "engine start wind limit"], ["ลมสูงสุด", "maximum wind"], ["ลมแรงสุด", "maximum wind"],
 ["ลมขวาง", "crosswind"], ["ลมปะทะ", "headwind"], ["องค์ประกอบลม", "wind component"],
 ["สภาพอากาศ", "weather"], ["เหตุฉุกเฉิน", "emergency"],
 ["ฝึกอบรม", "training"], ["สัมภาระ", "baggage"], ["เช็คอิน", "check in"],
 ["ผู้โดยสาร", "passenger"], ["หัวหน้านักบิน", "pilot in command captain name"], ["กัปตัน", "pilot in command captain name"], ["ชื่อหัวหน้านักบิน", "pilot in command captain name"], ["แผนการบิน", "flight plan"], ["รายงานอุบัติเหตุ", "accident reporting"],
];
export function normalizeKnowledgeQuery(value) {
 const original=String(value||"").trim().slice(0,300);
 const code=original.match(/OPS-(?:CM|CP)-\d{2}/i)?.[0].toUpperCase()||null;
 let text=original.replace(/OPS-(?:CM|CP)-\d{2}/ig,"");
 const mapped=[];
 for(const [thai,english] of aliases){if(text.includes(thai)){mapped.push(english);text=text.split(thai).join(" ");}}
 const typoText=text.replace(/visibilty|visiblity|visability/gi,"visibility").replace(/off[- ]?shore/gi,"offshore").replace(/take[- ]?of(f)?/gi,"take-off").replace(/cross wind/gi,"crosswind").replace(/head wind/gi,"headwind").replace(/windlimt/gi,"wind limit").replace(/minumum|minimumm/gi,"minimum");
 const latin=typoText.replace(/[^a-zA-Z0-9\s'-]/g," ").replace(/\s+/g," ").trim();
 const windHint=/\baw\s*139\b/i.test(original) && /(\bwind\b|ลม|crosswind|headwind)/i.test(original) && /(\blimit|maximum|สูงสุด|จำกัด)/i.test(original)
  ? "QRH wind component chart crosswind headwind limit"
  : "";
 const searchText=[...new Set([...mapped,latin,windHint].filter(Boolean))].join(" ").slice(0,300);
 return {original,searchText,documentCode:code,mapped:mapped.length>0};
}
export function knowledgeCommand(event) {
 if(event?.type!=="message"||event.message?.type!=="text"||!event.replyToken)return null;
 const text=String(event.message.text||"");
 const addressed=/^\s*@?avicore\s*bot\b/i.test(text)||event.message.mention?.mentionees?.some(m=>m.isSelf===true);
 // LINE direct messages can only arrive from users who have added the OA.
 // Allow a plain question in a direct chat; group/room messages still need
 // an explicit AviCore mention or prefix.
 // LINE may strip the visible @mention from message.text. Group membership is
 // already enforced by the webhook source, so accept text events from groups.
 if(["group","room"].includes(event.source?.type) && !addressed)return null;
 const clean=text.replace(/@?avicore\s*(bot)?/ig,"").trim();
 if(/^(ทดสอบ|test|ping|สวัสดี|ดีครับ|ดีค่ะ|hello|hi|กี่โมง|เวลา|time)\s*$/i.test(clean))return null;
 const match=clean.match(/^(?:ค้นหา|ค้น|search|find)\s*[:：]?\s*(.*)$/i);
 return match ? match[1].trim() : clean;
}
const clip=(value,max)=>{const chars=Array.from(String(value||""));return chars.length>max?chars.slice(0,max).join("")+"…":chars.join("");};
const clipReadable=(value,max)=>{
 const text=String(value||""); if(Array.from(text).length<=max)return text;
 const part=Array.from(text).slice(0,max).join("");
 const cut=Math.max(part.lastIndexOf(". "),part.lastIndexOf("; "),part.lastIndexOf("\n"),part.lastIndexOf(" "));
 return (cut>Math.floor(max*0.55)?part.slice(0,cut):part).trim()+"…";
};
export function cleanExcerpt(value){
 let text=String(value||"");
 const header=text.match(/^.{0,800}?\bPage\s+\d+\s*-\s*\d+\s*/s);
 if(header&&/APPROVAL/i.test(header[0]))text=text.slice(header[0].length);
 return text.replace(/UNCONTROLLED when printed\. Visit UOA online system for latest version\./g,"")
  // PDF extraction often inserts a newline between every visual line. Keep
  // the excerpt as flowing sentences so LINE does not show one word per row.
  .split(/\r?\n/).map(line=>line.replace(/[ \t]+/g," ").trim()).filter(Boolean).join(" ")
  .replace(/\s{2,}/g," ").trim();
}
function directNumericAnswer(result){
 const q=String(result.query?.original||"").toLowerCase();
 if(!/(visibility|vis|rvr|มองเห็น|ทัศนวิสัย|take.?off|ขั้นต่ำ|minimum)/i.test(q))return "";
 const text=result.results.slice(0,5).map(r=>cleanExcerpt(r.excerpt)).join(" ");
 const hits=[];
 // For the specific offshore take-off question, bind the number to the word
 // "offshore". This avoids OCR fragments such as 400 + 0 becoming 4000 and
 // avoids returning the unrelated 1400 m decision range.
 if(/take[ -]?off/i.test(q)&&/offshore|ทะเล/i.test(q)){
  const offshore=/(\d{2,4})\s*(?:meters?|metres?|m)\s*offshore/gi; let om;
  while((om=offshore.exec(text))&&hits.length<2){const value=`${om[1]} เมตร`;if(!hits.includes(value))hits.push(value);}
  if(hits.length)return `คำตอบ: ${hits[0]}`;
 }
 const re=/(?:offshore|onshore|rvr|visibility|vis(?:ibility)?|take[ -]?off)[^.!?]{0,180}?\b(\d{2,4})\s*(meters?|metres?|m)\b/gi;
 let m; while((m=re.exec(text))&&hits.length<4){const value=`${m[1]} เมตร`;if(!hits.includes(value))hits.push(value);}
 return hits.length?`ตัวเลขที่พบ: ${hits.join(" · ")}`:"";
}
export function formatKnowledgeResult(result) {
 if(!result.query.searchText)return `กรุณาระบุคำค้นภาษาอังกฤษ หรือคำไทยที่รองรับ เช่น เวลาพัก เชื้อเพลิงสำรอง วัตถุอันตราย\nตัวอย่าง: AviCore ค้นหา reserve fuel\n\n${KNOWLEDGE_NOTE}`;
 const header=`ผลค้นเอกสาร: ${result.query.searchText}${result.mode==='keyword'?' (ค้นคำตรงตัว)':''}`;
 if(!result.results.length)return `ผมยังไม่แน่ใจว่าต้องการค้นหาเรื่องไหนครับ ขอรายละเอียดเพิ่มอีกนิดได้ไหม เช่น\n• ต้องการค่าขั้นต่ำ/ค่าสูงสุดของอะไร\n• เป็นอากาศยานรุ่นใด เช่น AW139\n• เกี่ยวกับ FTL เช่น 90D, 180D, take-off, landing หรือ I.APP\n• หรือส่งรหัสเอกสาร เช่น OPS-CM-01\n\nตัวอย่าง: “AW139 minimum offshore take-off visibility”\n\n${KNOWLEDGE_NOTE}`;
 const blocks=result.results.slice(0,3).map((r,i)=>{
  const excerpt=cleanExcerpt(r.excerpt);
  return `ข้อ ${i+1}: ${clipReadable(excerpt,120)}\nอ้างอิง: ${clip(r.code,30)} · หน้า PDF ${r.page_no}`;
 });
 const direct=directNumericAnswer(result);
 return `${direct?`${direct}\n\n`:""}${header}\n\nคำตอบจากเอกสาร:\n${blocks.join("\n\n")}\n\nแหล่งข้อมูล: IQSMS Company Database\nตรวจสอบเอกสารฉบับเต็มและ revision ล่าสุดก่อนใช้งาน\n\n${KNOWLEDGE_NOTE}`;
}
export async function searchKnowledge(sb,model,companyId,value) {
 const query=normalizeKnowledgeQuery(value);
 if(!query.searchText)return {query,results:[],mode:"hybrid"};
 if(query.searchText.split(/\s+/).filter(Boolean).length < 2 && !query.documentCode) return {query,results:[],mode:"clarify"};
 let embedding=null,mode="hybrid";
 try {embedding=await model.run(query.searchText,{mean_pool:true,normalize:true});
  if(embedding.length!==384||!embedding.every(Number.isFinite))throw new Error("Invalid embedding");
 }catch{mode="keyword";embedding=null;}
 const {data,error}=await sb.rpc("avicore_hybrid_knowledge",{company:companyId,search_text:query.searchText,query_embedding:embedding,document_code:query.documentCode});
 if(error)throw error;
 let results=data||[];
 // Do not present an unrelated offshore procedure for a Pitch/Roll/Heave
 // question. At least one requested technical term must occur in the excerpt
 // or title; otherwise report no verified match instead of inventing a value.
 if(/pitch|roll|heave/i.test(query.original)){
  results=results.filter(r=>/pitch|roll|heave/i.test(`${r.title||""} ${r.excerpt||""}`));
 }
 return {query,results,mode};
}
async function geminiAnswer(result) {
 const key=Deno.env.get("GEMINI_API_KEY");
 if(!key||!result.results?.length)return null;
 const sources=result.results.slice(0,5).map((r,i)=>`อ้างอิง ${i+1}: ${r.code} — ${r.title}; Revision ${r.revision}; หน้า ${r.page_no}\n${clipReadable(cleanExcerpt(r.excerpt),1800)}`).join("\n\n");
 const prompt=`คุณคือ AviCore Bot สำหรับงานปฏิบัติการบิน ตอบภาษาไทยให้กระชับและแม่นยำ\nคำถาม: ${result.query.original}\n\nข้อมูลจาก Company Database (IQSMS):\n${sources}\n\nกติกาสำคัญ: บรรทัดแรกต้องเป็นคำตอบตรง ๆ พร้อมตัวเลขและหน่วยที่ถาม เช่น “Minimum Offshore Take-off Visibility = 400 เมตร” หรือ “Maximum Crosswind = 20 knots” ห้ามเริ่มด้วยคำว่า ผลค้นเอกสาร และห้ามอ้างอิงก่อนคำตอบ จากนั้นค่อยอธิบายเงื่อนไข แล้วใส่อ้างอิงเอกสารและหน้า PDF ไว้ท้ายคำตอบ ตอบจากข้อมูลที่ให้เท่านั้น ห้ามเดาตัวเลขหรือสร้างข้อกำหนดใหม่ หากข้อมูลไม่พอให้บอกว่าไม่พบตัวเลขที่ยืนยันได้ และลงท้ายด้วย: ${KNOWLEDGE_NOTE}`;
 try{const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]}),signal:AbortSignal.timeout(15000)});if(!response.ok){const errText=await response.text(); console.error("[gemini] request failed",response.status,errText.slice(0,500)); return null;}const data=await response.json();return data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim()||null;}catch{return null;}
}
async function geminiTranslate(command) {
 const key=Deno.env.get("GEMINI_API_KEY");
 if(!key)return null;
 const m=String(command).match(/^(?:แปลอังกฤษ|แปลคำว่า\s*(.*?)\s*เป็นภาษาอังกฤษ|translate\s+to\s+english)\s*[:：]?\s*(.*)$/i);
 const n=String(command).match(/^(?:แปลไทย|แปลคำว่า\s*(.*?)\s*เป็นภาษาไทย|translate\s+to\s+thai)\s*[:：]?\s*(.*)$/i);
 if(!m&&!n)return null;
 const target=m?"English":"Thai"; const hit=m||n; const source=(hit[2] || hit[1] || "").trim().slice(0,3000);
 const quick={"reserve fuel":"เชื้อเพลิงสำรอง","เชื้อเพลิงสำรอง":"reserve fuel","fuel":"เชื้อเพลิง","เชื้อเพลิง":"fuel"}; const quickValue=quick[source.toLowerCase()]; if(quickValue)return quickValue;
 if(!source)return `กรุณาระบุข้อความที่ต้องการแปล เช่น แปลอังกฤษ: ตรวจสอบเอกสารก่อนบิน`;
 const prompt=`Translate the following aviation/company text into ${target}. Preserve technical terms, numbers, units, warnings, and formatting. Return only the translation, no explanation. Text:\n${source}`;
 try{const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]}),signal:AbortSignal.timeout(15000)});if(!response.ok){const errText=await response.text(); console.error("[gemini] request failed",response.status,errText.slice(0,500)); return null;}const data=await response.json();return data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim()||null;}catch{return null;}
}
async function geminiGeneral(command) {
 const key=Deno.env.get("GEMINI_API_KEY"); if(!key)return null;
 const prompt=`คุณคือ AviCore Bot ผู้ช่วยทั่วไป ตอบภาษาไทยแบบตรงประเด็น ห้ามทักทายและห้ามขึ้นต้นด้วยคำอธิบาย หากถามเวลาพระอาทิตย์ขึ้นหรือตก ให้ตอบบรรทัดแรกเป็นเวลาทันทีในรูปแบบ “พระอาทิตย์ขึ้นที่จังหวัดสงขลา: HH:MM น.” แล้วค่อยระบุวันที่และแหล่งข้อมูล หากข้อมูลเปลี่ยนแปลงได้ให้บอกสั้น ๆ ท้ายคำตอบ คำถาม: ${String(command).slice(0,1000)}`;
 try{const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]}),signal:AbortSignal.timeout(15000)});if(!response.ok){const errText=await response.text(); console.error("[gemini] request failed",response.status,errText.slice(0,500)); return null;}const data=await response.json();return data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim()||null;}catch{return null;}
}
export async function replyKnowledge(event,{groupId,search}) {
 const command=knowledgeCommand(event);
 if(command===null)return null;
 const fullRequest=/^more\s+all$/i.test(String(command).trim());
 const translated=await geminiTranslate(command);
 if(translated)return translated;
 if(event.source?.type==="user") {
  try{const result=await search(command);if(!result.query.searchText){const general=await geminiGeneral(command);if(general)return general;}return `${fullRequest?"__FULL__":""}${fullRequest?formatKnowledgeResult(result):(directNumericAnswer(result)+(directNumericAnswer(result)?"\\n\\n":"")+((await geminiAnswer(result))||formatKnowledgeResult(result)))}`;}
  catch{return `ขณะนี้ค้นเอกสารไม่ได้ กรุณาลองใหม่ครับ\n\n${KNOWLEDGE_NOTE}`;}
 }
 if(event.source?.type!=="group"||!event.source.groupId)
  return "ค้นเอกสารบริษัทได้เฉพาะในกลุ่มที่เพิ่ม AviCore Bot ไว้ครับ";
 try{const result=await search(command);if(!result.query.searchText){const general=await geminiGeneral(command);if(general)return general;}return `${fullRequest?"__FULL__":""}${fullRequest?formatKnowledgeResult(result):(directNumericAnswer(result)+(directNumericAnswer(result)?"\\n\\n":"")+((await geminiAnswer(result))||formatKnowledgeResult(result)))}`;}
 catch{return `ขณะนี้ค้นเอกสารไม่ได้ กรุณาลองใหม่ หรือเปิด IQSMS โดยตรงครับ\n\n${KNOWLEDGE_NOTE}`;}
}
