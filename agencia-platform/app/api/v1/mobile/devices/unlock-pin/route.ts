import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";
import { loadMobileAutomationAccess, requireSerialLinkedToWorkspace } from "@/lib/mobile/automation-access";
import { DEFAULT_ANDROID_UNLOCK_PIN } from "@/lib/mobile/unlock-pin";
const schema = z.object({ deviceSerial: z.string().trim().min(1).max(160), action: z.enum(['status','save','resolve']), pin: z.string().regex(/^(?:[0-9]{4,16})?$/, 'Introduce entre 4 y 16 números, o deja el campo vacío.').optional() }).strict();
export const POST = withApi({scope:'*',rate:'admin'}, async(req,{api})=>{
 const parsed=schema.safeParse(await req.json().catch(()=>null));
 if(!parsed.success) throw new ApiError(400,'validation_error',parsed.error.issues[0]?.message ?? 'Datos no válidos');
 const {workspace,phones}=await loadMobileAutomationAccess(api.workspaceId,api.userId,{manager:true});
 requireSerialLinkedToWorkspace(phones,parsed.data.deviceSerial);
 const {deviceSerial,action,pin}=parsed.data;
 const settings=(workspace.settings ?? {}) as Record<string,unknown>;
 const records=(settings.mobileUnlockPins ?? {}) as Record<string,string>;
 const stored=Object.prototype.hasOwnProperty.call(records,deviceSerial) ? records[deviceSerial] : undefined;
 if(action==='save') {
  if(pin===undefined) throw new ApiError(400,'missing_pin','Falta el PIN. Envía el campo vacío para usar el predeterminado.');
  const cipher=pin ? encryptSecret(pin) : null;
  await prisma.$transaction(async tx=>{
   const fresh=await tx.workspace.findUnique({where:{id:api.workspaceId},select:{settings:true}});
   if(!fresh) throw new ApiError(404,'workspace_missing','El espacio ya no existe');
   const current=structuredClone((fresh.settings ?? {}) as Record<string,unknown>);
   const pins={...((current.mobileUnlockPins ?? {}) as Record<string,string>)};
   if(cipher) Object.defineProperty(pins,deviceSerial,{value:cipher,enumerable:true,writable:true,configurable:true}); else delete pins[deviceSerial];
   await tx.workspace.update({where:{id:api.workspaceId},data:{settings:{...current,mobileUnlockPins:pins} as never}});
  },{isolationLevel:'Serializable'});
  return NextResponse.json({custom:!!pin},{headers:{'Cache-Control':'no-store'}});
 }
 if(action==='status') return NextResponse.json({custom:!!stored},{headers:{'Cache-Control':'no-store'}});
 const resolved=stored ? decryptSecret(stored) : DEFAULT_ANDROID_UNLOCK_PIN;
 if(!resolved || !/^[0-9]{4,16}$/.test(resolved)) throw new ApiError(409,'pin_unavailable','No se puede recuperar el PIN guardado. Guárdalo de nuevo antes de desbloquear.');
 return NextResponse.json({pin:resolved},{headers:{'Cache-Control':'no-store'}});
});
