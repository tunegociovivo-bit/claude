import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({findMany:vi.fn(),updateMany:vi.fn(),update:vi.fn(),keys:vi.fn(),hunter:vi.fn(),hunterCompany:vi.fn(),apollo:vi.fn()}));

vi.mock("@/lib/db/prisma",()=>({prisma:{prospectingProspect:{findMany:mocks.findMany,updateMany:mocks.updateMany,update:mocks.update}}}));
vi.mock("@/lib/leads/enrich-contacts",()=>({resolveContactKeys:mocks.keys,hunterDomainSearch:mocks.hunter,hunterCompanySearch:mocks.hunterCompany,apolloFindDecisionMakers:mocks.apollo}));

import { autoResolveProspectingProfiles } from "../prospecting-resolver";

describe("autoResolveProspectingProfiles",()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.updateMany.mockResolvedValue({count:1});mocks.update.mockResolvedValue({});mocks.keys.mockResolvedValue({hunterKey:"hunter",apolloKey:"apollo"})});

 it("continúa con Apollo cuando Hunter falla y resuelve una identidad exacta",async()=>{
  mocks.findMany.mockResolvedValue([{id:"p1",workspaceId:"w1",campaignId:"c1",firstName:"Ana",lastName:"García",companyName:"Acme",companyDomain:"acme.es",website:null,email:null,phone:null,linkedinUrl:null,jobTitle:null,metadata:{},resolutionStatus:"unresolved",resolutionAttempts:0,nextResolutionAt:null,createdAt:new Date(),campaign:{status:"active"}}]);
  mocks.hunter.mockRejectedValue(new Error("Hunter temporalmente no disponible"));
  mocks.apollo.mockResolvedValue([{name:"Ana García",email:"ana@acme.es",linkedin:"https://linkedin.com/in/ana",title:"CMO"}]);

  const result=await autoResolveProspectingProfiles();

  expect(result).toEqual({processed:1,resolved:1,retrying:0});
  expect(mocks.updateMany).toHaveBeenCalledOnce();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:"p1"},data:expect.objectContaining({resolutionStatus:"resolved",status:"active",email:"ana@acme.es",linkedinUrl:"https://linkedin.com/in/ana"})}));
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
