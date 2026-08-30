import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";
export const GET = withApi({scope:"*"}, async (_req,{api})=>{
  if(!api.userId) throw new ApiError(401,"unauthenticated","Usuario no identificado");
  const start=new Date(); start.setHours(0,0,0,0); const end=new Date(start); end.setDate(end.getDate()+1);
  const [sessions,activities]=await Promise.all([
    prisma.timeTrackerSession.findMany({where:{workspaceId:api.workspaceId,userId:api.userId,startedAt:{gte:start,lt:end}},orderBy:{startedAt:"asc"}}),
    prisma.timeTrackerActivity.findMany({where:{workspaceId:api.workspaceId,userId:api.userId,bucketStart:{gte:start,lt:end}},select:{durationSec:true,idle:true}})
  ]);
  const now=Date.now(); const workedSec=Math.round(sessions.reduce((n,s)=>n+Math.max(0,((s.endedAt?.getTime()??now)-s.startedAt.getTime())/1000),0));
  const idleSec=activities.filter(a=>a.idle).reduce((n,a)=>n+a.durationSec,0);
  return NextResponse.json({date:start,startedAt:sessions[0]?.startedAt??null,endedAt:sessions.at(-1)?.endedAt??null,workedSec,idleSec,active:sessions.some(s=>!s.endedAt)});
});
