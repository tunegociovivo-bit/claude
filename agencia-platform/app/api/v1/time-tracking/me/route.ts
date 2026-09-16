import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";
export const GET = withApi({scope:"time_tracking:write"}, async (req,{api})=>{
  if(!api.userId) throw new ApiError(401,"unauthenticated","Usuario no identificado");
  let start=new Date(); start.setHours(0,0,0,0); let end=new Date(start); end.setDate(end.getDate()+1);
  // The desktop sends its local calendar-day boundaries, including DST.
  const params = new URL(req.url).searchParams;
  if (params.has("dayStart") || params.has("dayEnd")) {
    const requestedStart = new Date(params.get("dayStart") ?? "");
    const requestedEnd = new Date(params.get("dayEnd") ?? "");
    const span = requestedEnd.getTime() - requestedStart.getTime();
    if (!Number.isFinite(span) || span < 23 * 3600000 || span > 25 * 3600000 || requestedStart.getTime() > Date.now() || requestedEnd.getTime() <= Date.now())
      throw new ApiError(400,"invalid_request","Intervalo del día inválido");
    start = requestedStart; end = requestedEnd;
  }
  const [sessions,activities]=await Promise.all([
    prisma.timeTrackerSession.findMany({where:{workspaceId:api.workspaceId,userId:api.userId,startedAt:{lt:end},OR:[{endedAt:null},{endedAt:{gt:start}}]},orderBy:{startedAt:"asc"}}),
    prisma.timeTrackerActivity.findMany({where:{workspaceId:api.workspaceId,userId:api.userId,bucketStart:{gte:start,lt:end}},select:{durationSec:true,idle:true}})
  ]);
  const now=Date.now(); const workedSec=Math.floor(sessions.reduce((n,s)=>n+Math.max(0,(Math.min(s.endedAt?.getTime()??now,now,end.getTime())-Math.max(s.startedAt.getTime(),start.getTime()))/1000),0));
  const idleSec=activities.filter(a=>a.idle).reduce((n,a)=>n+a.durationSec,0);
  return NextResponse.json({date:start,startedAt:sessions[0]?.startedAt??null,endedAt:sessions.at(-1)?.endedAt??null,workedSec,idleSec,active:sessions.some(s=>!s.endedAt)});
});
