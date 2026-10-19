import {describe,it,expect,vi} from "vitest";
import {classifyAdminQuery,replyAdminData} from "./admin-data.js";

const groupEvent=(groupId,text)=>({
 type:"message",replyToken:"reply",source:{type:"group",groupId},message:{type:"text",text}
});
const userEvent=text=>({
 type:"message",replyToken:"reply",source:{type:"user",userId:"U123"},message:{type:"text",text}
});

describe("AviCore Admin data access",()=>{
 it("classifies operational Admin queries and extracts pilot code",()=>{
  expect(classifyAdminQuery("ตารางบิน WJU พรุ่งนี้")).toMatchObject({kind:"roster",pilotCode:"WJU",dayOffset:1});
  expect(classifyAdminQuery("ข้อมูล training ของ PDE")).toMatchObject({kind:"training",pilotCode:"PDE"});
  expect(classifyAdminQuery("ชั่วโมงบิน KSU")).toMatchObject({kind:"experience",pilotCode:"KSU"});
 });

 it("answers only in the configured company group",async()=>{
  const read=vi.fn().mockResolvedValue([{pilot_code:"WJU",pilot_name:"Captain Weera",date:"2026-10-20",code:"OFF"}]);
  expect(await replyAdminData(groupEvent("other","AviCore Bot ตารางบิน WJU"),{groupId:"pilot",read})).toBeNull();
  const text=await replyAdminData(groupEvent("pilot","AviCore Bot ตารางบิน WJU พรุ่งนี้"),{groupId:"pilot",read,now:new Date("2026-10-19T08:00:00Z")});
  expect(text).toContain("WJU");
  expect(text).toContain("2026-10-20");
  expect(text).toContain("AviCore Admin");
  expect(read).toHaveBeenCalledTimes(1);
 });

 it("refuses protected Admin data in direct messages",async()=>{
  const read=vi.fn();
  const text=await replyAdminData(userEvent("ข้อมูล training ของ PDE"),{groupId:"pilot",read});
  expect(text).toContain("เฉพาะกลุ่มนักบิน");
  expect(read).not.toHaveBeenCalled();
 });

 it("redacts sensitive and binary fields from record_json",async()=>{
  const read=vi.fn().mockResolvedValue([{
   code:"PDE",name:"Pilot Demo",record_json:{licence:"ATPL",nightCurrency:"2026-12-01",email:"secret@example.com",phone:"0812345678",medicalNote:"private",photo:"data:image/png;base64,abc"}
  }]);
  const text=await replyAdminData(groupEvent("pilot","AviCore Bot training PDE"),{groupId:"pilot",read});
  expect(text).toContain("ATPL");
  expect(text).toContain("2026-12-01");
  expect(text).not.toContain("secret@example.com");
  expect(text).not.toContain("0812345678");
  expect(text).not.toContain("private");
  expect(text).not.toContain("base64");
 });
});
