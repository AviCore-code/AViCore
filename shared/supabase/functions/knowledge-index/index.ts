import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";
import {searchKnowledge} from "../_shared/knowledge.js";
const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const model=new Supabase.ai.Session('gte-small');
Deno.serve(async req=>{
 if(req.method!=="POST") return new Response(null,{status:405});
 const candidate=req.headers.get("Authorization")?.replace(/^Bearer /,"")||"";
 const {data:allowed,error:authError}=await sb.rpc("avicore_verify_line_cron",{candidate});
 if(authError||allowed!==true) return new Response(null,{status:401});
 try {
  const input=await req.json();
  if(typeof input.query==='string'){
   const {data:company,error}=await sb.from('companies').select('id').eq('slug',Deno.env.get('COMPANY_SLUG')||'uoa').single();
   if(error)throw error;
   return Response.json(await searchKnowledge(sb,model,company.id,input.query));
  }
  if(input.probe){
   const vector=await model.run("Flight time limitations and rest periods",{mean_pool:true,normalize:true});
   return Response.json({dimensions:vector.length,finite:vector.every(Number.isFinite)});
  }
  const after=Math.max(0,Number(input.after)||0);
  const {data:rows,error}=await sb.from("avicore_kb_chunks").select("id,content").is("embedding",null).gt("id",after).lte("id",after+4).order("id").limit(4);
  if(error) throw error;
  let completed=0;
  for(const row of rows||[]){
   const embedding=await model.run(row.content,{mean_pool:true,normalize:true});
   if(embedding.length!==384||!embedding.every(Number.isFinite)) throw new Error("Invalid vector");
   const {error:saveError}=await sb.from("avicore_kb_chunks").update({embedding}).eq("id",row.id).is("embedding",null);
   if(saveError) throw saveError;
   completed++;
  }
  return Response.json({completed,lastId:rows?.at(-1)?.id||after});
 }catch{console.error("Knowledge indexing failed");return Response.json({error:"Index failed"},{status:500});}
});

