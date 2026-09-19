import {it,expect,vi} from "vitest";
import {normalizeKnowledgeQuery,replyKnowledge,formatKnowledgeResult,searchKnowledge,KNOWLEDGE_NOTE} from "./knowledge.js";
const event=(groupId,text="AviCore Bot ค้นหา เวลาพัก")=>({type:"message",replyToken:"test",source:{type:"group",groupId},message:{type:"text",text}});
it("maps known Thai terms and keeps document filters",()=>{
 expect(normalizeKnowledgeQuery("OPS-CM-01 เชื้อเพลิงสำรอง")).toMatchObject({searchText:"reserve fuel",documentCode:"OPS-CM-01",mapped:true});
 expect(normalizeKnowledgeQuery("คำที่ไม่มีในพจนานุกรม").searchText).toBe("");
});
it("searches addressed groups and ignores rooms",async()=>{
 const search=vi.fn().mockResolvedValue({query:{searchText:"rest period"},mode:"hybrid",results:[]});
 await replyKnowledge({...event("friends","เวลาพัก"),source:{type:"group",groupId:"friends"}},{groupId:"pilot",search});
 await replyKnowledge({...event("pilot","AviCore Bot ค้นหา เวลาพัก"),source:{type:"room",roomId:"pilot"}},{groupId:"pilot",search});
 await replyKnowledge(event("pilot","AviCore Bot ค้นหา เวลาพัก"),{groupId:"pilot",search});
 expect(search).toHaveBeenCalledTimes(1);
});
it("allows a friend direct chat to search",async()=>{
 const search=vi.fn().mockResolvedValue({query:{searchText:"rest period"},mode:"hybrid",results:[]});
 const direct={...event("pilot","เวลาพัก"),source:{type:"user",userId:"Ufriend"}};
 const reply=await replyKnowledge(direct,{groupId:"pilot",search});
 expect(search).toHaveBeenCalledWith("เวลาพัก");expect(reply).toContain("ขอรายละเอียดเพิ่ม");
});
it("preserves citations and footer under LINE length limit",()=>{
 const text=formatKnowledgeResult({query:{searchText:"rest"},mode:"hybrid",results:Array.from({length:3},()=>({code:"OPS-CM-01",title:"Manual",revision:"Rev 1",page_no:200,excerpt:"✈️".repeat(8000),checked_at:"2026-09-06"}))});
 expect(text.length).toBeLessThanOrEqual(5000);expect(text).toContain("หน้า PDF 200");expect(text.endsWith(KNOWLEDGE_NOTE)).toBe(true);
});
it("falls back to keyword when embedding fails, preserving tenant",async()=>{
 const sb={rpc:vi.fn().mockResolvedValue({data:[]})};
 const result=await searchKnowledge(sb,{run:vi.fn().mockRejectedValue(new Error())},"tenant","reserve fuel");
 expect(result.mode).toBe("keyword");expect(sb.rpc.mock.calls[0][1]).toMatchObject({company:"tenant",query_embedding:null});
});
it("returns an explicit failure instead of a fabricated result",async()=>{
 const text=await replyKnowledge(event("pilot","AviCore Bot ค้นหา เวลาพัก"),{groupId:"pilot",search:async()=>{throw Error();}});
 expect(text).toContain("ค้นเอกสารไม่ได้");expect(text.endsWith(KNOWLEDGE_NOTE)).toBe(true);
});
