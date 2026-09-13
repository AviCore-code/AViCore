import { handleWebhook } from "./replies.js";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2.110.2";
import {replyKnowledge,searchKnowledge} from "../_shared/knowledge.js";
const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const model=new Supabase.ai.Session('gte-small');
async function auditLineEvent(event:any, ctx:{fetcher:typeof fetch,token?:string,now:Date}) {
  const source=event?.source||{};
  const userId=source.userId;
  if(!userId) return;
  const {data:company,error}=await sb.from('companies').select('id').eq('slug',Deno.env.get('COMPANY_SLUG')||'uoa').single();
  if(error) throw error;
  let displayName:string|undefined; let pictureUrl:string|undefined;
  if(ctx.token && (source.type==='user' || source.type==='group')) {
    const res=await ctx.fetcher(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`,{headers:{Authorization:`Bearer ${ctx.token}`}});
    if(res.ok){const p=await res.json(); displayName=p.displayName; pictureUrl=p.pictureUrl;}
  }
  const eventType=event.type==='memberJoined'?'member_joined':event.type==='memberLeft'?'member_left':event.type==='follow'?'friend_added':event.type==='unfollow'?'friend_removed':event.type||'unknown';
  await sb.from('admin_line_user_events').insert({company_id:company.id,line_user_id:userId,line_group_id:source.groupId||null,event_type:eventType,display_name:displayName||null,picture_url:pictureUrl||null,occurred_at:new Date(event.timestamp||ctx.now.getTime()).toISOString(),raw_event:event});
}
// LINE signature verification replaces Supabase JWT authentication.
// Company excerpts are allowed only in the server-configured pilot group.
Deno.serve(req => handleWebhook(req, {
  secret: Deno.env.get("LINE_CHANNEL_SECRET"),
  token: Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN"),
  auditEvent:auditLineEvent,
  knowledgeReply:async event=>{
    const {data:company}=await sb.from("companies").select("id").eq("slug",Deno.env.get("COMPANY_SLUG")||"uoa").single();
    const {data:botConfig}=company ? await sb.from("Admin_app_settings").select("value_json").eq("company_id",company.id).eq("key","line_bot_config").is("deleted_at",null).maybeSingle() : {data:null};
    const cfg=botConfig?.value_json||{};
    if(cfg.replyEnabled===false) return false;
    if(["group","room"].includes(event?.source?.type) && cfg.groupConversationEnabled===false) return false;
    if(cfg.knowledgeEnabled===false) return null;
    return replyKnowledge(event,{groupId:Deno.env.get("LINE_PILOT_GROUP_ID"),search:async query=>{
    const {data:company,error}=await sb.from("companies").select("id").eq("slug",Deno.env.get("COMPANY_SLUG")||"uoa").single();
    if(error)throw error;
    let actualQuery=query;
    if(/^more\s+all$/i.test(String(query).trim())){
      const {data:history}=await sb.from("admin_line_user_events").select("raw_event").eq("company_id",company.id).eq("line_user_id",event?.source?.userId||"").eq("event_type","message").order("occurred_at",{ascending:false}).limit(20);
      const previous=(history||[]).map(r=>r.raw_event?.message?.text).find(t=>t&&!/^more\s+all$/i.test(String(t).trim()));
      actualQuery=previous||query;
    }
    return searchKnowledge(sb,model,company.id,actualQuery);
  }});
  },
}));


