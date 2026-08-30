import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({findMany:vi.fn(),updateMany:vi.fn(),update:vi.fn(),keys:vi.fn(),hunter:vi.fn(),hunterCompany:vi.fn(),apollo:vi.fn()}));

vi.mock("@/lib/db/prisma",()=>({prisma:{prospectingProspect:{findMany:mocks.findMany,updateMany:mocks.updateMany,update:mocks.update}}}));
vi.mock("@/lib/leads/enrich-contacts",()=>({resolveContactKeys:mocks.keys,hunterDomainSearch:mocks.hunter,hunterCompanySearch:mocks.hunterCompany,apolloFindDecisionMakers:mocks.apollo}));

import { autoResolveProspectingProfiles, scheduleResolvedProspect } from "../prospecting-resolver";

describe("autoResolveProspectingProfiles",()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.updateMany.mockResolvedValue({count:1});mocks.update.mockResolvedValue({});mocks.keys.mockResolvedValue({hunterKey:"hunter",apolloKey:"apollo"})});

 it("continúa con Apollo cuando Hunter falla y resuelve una identidad exacta",async()=>{
  mocks.findMany.mockResolvedValue([{id:"p1",workspaceId:"w1",campaignId:"c1",firstName:"Ana",lastName:"García",companyName:"Acme",companyDomain:"acme.es",website:null,email:null,phone:null,linkedinUrl:null,jobTitle:null,metadata:{},resolutionStatus:"unresolved",resolutionAttempts:0,nextResolutionAt:null,createdAt:new Date(),campaign:{status:"active"}}]);
  mocks.hunter.mockRejectedValue(new Error("Hunter temporalmente no disponible"));
  mocks.apollo.mockResolvedValue([{name:"Ana García",email:"ana@acme.es",linkedin:"https://linkedin.com/in/ana",title:"CMO"}]);

  const result=await autoResolveProspectingProfiles();

  expect(result).toEqual({processed:1,resolved:1,retrying:0});
  expect(mocks.updateMany).toHaveBeenCalledTimes(2);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:"p1"},data:expect.objectContaining({resolutionStatus:"resolved",email:"ana@acme.es",linkedinUrl:"https://linkedin.com/in/ana"})}));
  expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("status");
  expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:"p1",status:"pending_resolution"}),data:expect.objectContaining({status:"active"})}));
 });

 it("no procesa un perfil si otra ejecución ya obtuvo el bloqueo",async()=>{
  mocks.findMany.mockResolvedValue([{id:"p1",workspaceId:"w1",resolutionStatus:"retry_pending",resolutionAttempts:1,nextResolutionAt:new Date()}]);
  mocks.updateMany.mockResolvedValue({count:0});

  const result=await autoResolveProspectingProfiles();

  expect(result).toEqual({processed:1,resolved:0,retrying:0});
  expect(mocks.keys).not.toHaveBeenCalled();
 expect(mocks.update).not.toHaveBeenCalled();
 });

 it("reintenta si un proveedor falla y los restantes no encuentran identidad",async()=>{
  mocks.findMany.mockResolvedValue([{id:"p2",workspaceId:"w1",campaignId:"c1",firstName:"Luis",lastName:"Pérez",companyName:"Acme",companyDomain:"acme.es",website:null,email:null,phone:null,linkedinUrl:null,jobTitle:null,metadata:{},resolutionStatus:"unresolved",resolutionAttempts:0,nextResolutionAt:null,createdAt:new Date(),campaign:{status:"active"}}]);
  mocks.hunter.mockRejectedValue(new Error("Hunter HTTP 429"));
  mocks.apollo.mockResolvedValue([]);

  const result=await autoResolveProspectingProfiles();

  expect(result).toEqual({processed:1,resolved:0,retrying:1});
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:"p2"},data:expect.objectContaining({resolutionStatus:"retry_pending",resolutionAttempts:1})}));
  expect(mocks.update.mock.calls[0][0].data.resolutionStatus).not.toBe("not_found");
 });
});

describe("scheduleResolvedProspect",()=>{
 it("solo activa mediante CAS si el perfil sigue pendiente de resolución",async()=>{
  mocks.updateMany.mockReset().mockResolvedValueOnce({count:1});const now=new Date();
  expect(await scheduleResolvedProspect("p1","w1",now)).toBe("active");
  expect(mocks.updateMany).toHaveBeenCalledWith({where:{id:"p1",workspaceId:"w1",status:"pending_resolution",campaign:{status:"active"}},data:{status:"active",nextActionAt:now}});
 });
 it("no sobrescribe una respuesta o exclusión concurrente",async()=>{
  mocks.updateMany.mockReset().mockResolvedValueOnce({count:0}).mockResolvedValueOnce({count:0});
  expect(await scheduleResolvedProspect("p1","w1")).toBe("unchanged");
  expect(mocks.updateMany).toHaveBeenLastCalledWith({where:{id:"p1",workspaceId:"w1",status:"pending_resolution"},data:{status:"pending",nextActionAt:null}});
 });
 it("revalida una activación concurrente después de pasar a pendiente",async()=>{
  mocks.updateMany.mockReset().mockResolvedValueOnce({count:0}).mockResolvedValueOnce({count:1}).mockResolvedValueOnce({count:1});const now=new Date();
  expect(await scheduleResolvedProspect("p1","w1",now)).toBe("active");
  expect(mocks.updateMany).toHaveBeenLastCalledWith({where:{id:"p1",workspaceId:"w1",status:"pending",campaign:{status:"active"}},data:{status:"active",nextActionAt:now}});
 });
});
