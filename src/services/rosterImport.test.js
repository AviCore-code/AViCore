import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import {parseRosterWorkbook} from './rosterImport.js';
function workbook(codes=['SKL',null,' ']) {
 const ws=XLSX.utils.aoa_to_sheet([['BASE','NO.','NAME','CODE',new Date('2026-09-01T00:00:00Z'),new Date('2026-09-02T00:00:00Z'),new Date('2026-09-03T00:00:00Z')],['SKL',1,'Test Pilot','ABC',...codes],['Legend',null,'Ignore','XXX','OFF']],{cellDates:true});
 return {SheetNames:['RR 2026'],Sheets:{'RR 2026':ws}};
}
describe('roster Excel replacement',()=>{
 it('includes blank cells as deletions and excludes legend rows',()=>{
  const p=parseRosterWorkbook(workbook(),'RR 2026');
  expect(p.entries).toHaveLength(3);
  expect(p.entries.map(e=>e.clearExisting)).toEqual([false,true,true]);
  expect(p.pilots).toHaveLength(1);
 });
 it('allows a fully blank schedule to clear all its existing days',()=>{
  expect(parseRosterWorkbook(workbook([null,null,null]),'RR 2026').entries.every(e=>e.clearExisting)).toBe(true);
 });
 it('upserts new schedules and deletion markers together, and can restore a cleared day',async()=>{
  const source=fs.readFileSync(new URL('./webDatabase.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function rawImportRosterMany('),source.indexOf('async function rawDeleteRosterEntry('));
  let written=[];const sb={from:(table)=>{expect(table).toBe('Admin_pilot_roster');return {upsert:async(rows)=>{written=rows;return {error:null}}}}};
  const run=new Function('requireSupabase','getDeviceId','currentCompanyId',fn+'; return rawImportRosterMany;')(()=>sb,()=> 'test',async()=> 'company');
  await run(parseRosterWorkbook(workbook(),'RR 2026').entries);
  expect(written[0].deleted_at).toBeNull();expect(written[1].deleted_at).toBeTruthy();
  expect(written.every(r=>r.company_id==='company')).toBe(true);
  await run(parseRosterWorkbook(workbook(['OFF','SKL','OFF']),'RR 2026').entries);
  expect(written.every(r=>r.deleted_at===null)).toBe(true);
 });
});

