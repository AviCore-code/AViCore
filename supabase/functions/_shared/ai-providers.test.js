import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {aiProviderReply} from "./ai-providers.js";

const originalDeno=globalThis.Deno;

beforeEach(()=>{
 globalThis.Deno={env:{get:vi.fn(name=>({
  AVICORE_AI_PROXY_URL:"https://avicore.pro/internal/ai",
  AVICORE_AI_PROXY_TOKEN:"proxy-token",
  GEMINI_API_KEY:"gemini-key",
 }[name]||""))}};
});

afterEach(()=>{
 globalThis.Deno=originalDeno;
 vi.unstubAllGlobals();
});

describe("AI provider routing",()=>{
 it("uses the public authenticated AI proxy without putting tokens in URLs",async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:"ok"}}]}),{status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",fetcher);
  const result=await aiProviderReply("hello");
  expect(result).toMatchObject({provider:"chatgpt",reply:"ok"});
  const [url,options]=fetcher.mock.calls[0];
  expect(url).toBe("https://avicore.pro/internal/ai/v1/chat/completions");
  expect(url).not.toContain("proxy-token");
  expect(options.headers.Authorization).toBe("Bearer proxy-token");
 });

 it("falls back from ChatGPT to Claude",async()=>{
  const fetcher=vi.fn()
   .mockResolvedValueOnce(new Response("down",{status:503}))
   .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:"claude ok"}}]}),{status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",fetcher);
  const result=await aiProviderReply("hello","");
  expect(result).toMatchObject({provider:"claude",reply:"claude ok"});
  expect(JSON.parse(fetcher.mock.calls[1][1].body).model).toBe("claude-haiku-4-5-20251001");
 });
});
