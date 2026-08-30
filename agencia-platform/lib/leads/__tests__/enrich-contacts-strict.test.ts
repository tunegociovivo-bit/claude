import { afterEach, describe, expect, it, vi } from "vitest";
import { apolloFindDecisionMakers, hunterDomainSearch } from "../enrich-contacts";

describe("proveedores de enriquecimiento en modo estricto",()=>{
 afterEach(()=>vi.unstubAllGlobals());

 it("propaga un HTTP de Apollo para que el resolvedor pueda reintentarlo",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({error:"rate_limit"}),{status:429,headers:{"content-type":"application/json"}})));
  await expect(apolloFindDecisionMakers({domain:"acme.es",apiKey:"secret",throwOnError:true})).rejects.toThrow("Apollo respondi\u00f3 HTTP 429");
 });

 it("conserva el comportamiento best-effort para los consumidores existentes",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:503,headers:{"content-type":"application/json"}})));
  await expect(hunterDomainSearch({domain:"acme.es",apiKey:"secret"})).resolves.toEqual([]);
 });
});
