import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic="force-dynamic";
export const GET=withApi({scope:"time_tracking:write"},async(_req,{api})=>{
  if(!api.userId) throw new ApiError(401,"user_required","Agente sin usuario");
  const p=await prisma.timeTrackerPolicy.findUnique({where:{userId:api.userId}});
  return NextResponse.json(p??{trackingEnabled:true,collectApps:true,collectDomains:true,collectWindowTitles:false,collectIdle:true,screenshotsEnabled:true,screenshotInterval:10,screenshotJitter:20,blurScreenshots:false,retentionDays:30,allowPrivateMode:true,excludedApps:[]});
});
