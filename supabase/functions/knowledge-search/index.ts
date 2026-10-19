import {createClient} from "https://esm.sh/@supabase/supabase-js@2.110.2";
import {searchKnowledge,formatKnowledgeResult} from "../_shared/knowledge.js";
const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const model=new Supabase.ai.Session('gte-small');
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type,x-avicore-company","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(data,status=200)=>Response.json(data,{status,headers:cors});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const jwt=req.headers.get("Authorization")?.replace(/^Bearer /,"")||"";
  const {data:auth,error:authError}=await sb.auth.getUser(jwt);
  if(authError||!auth.user)return json({error:"กรุณาเข้าสู่ระบบ Admin"},401);
  const {data:company,error:companyError}=await sb.from("companies").select("id").eq("slug",Deno.env.get("COMPANY_SLUG")||"uoa").single();
  if(companyError)throw companyError;
  const {data:member,error:memberError}=await sb.from("company_members").select("role").eq("company_id",company.id).eq("user_id",auth.user.id).maybeSingle();
  if(memberError)throw memberError;
  if(!member||!["admin","owner"].includes(member.role))return json({error:"ไม่มีสิทธิ์ค้นเอกสารบริษัทนี้"},403);
  const body=await req.json();
  if(body.action==="list"){
   const {data,error}=await sb.from("avicore_kb_documents").select("code,title,revision,page_count,checked_at,active").eq("company_id",company.id).order("code");
   if(error)throw error;return json({documents:data});
  }
  if(typeof body.query!=="string"||body.query.length>300)return json({error:"คำค้นต้องไม่เกิน 300 ตัวอักษร"},400);
  const result=await searchKnowledge(sb,model,company.id,body.query);
  return json({...result,text:formatKnowledgeResult(result)});
 }catch{console.error("Knowledge search failed");return json({error:"ค้นเอกสารไม่สำเร็จ กรุณาลองใหม่"},503);}
});
