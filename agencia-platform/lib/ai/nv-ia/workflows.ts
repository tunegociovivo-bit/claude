/**
 * Workflows automáticos por cliente (Fase 41).
 *
 * Cada workflow es una secuencia de pasos programados (con dayOffset
 * desde el inicio). El cron /api/cron/ai-agent/workflow-tick recorre
 * AiClientWorkflow ACTIVE, mira si el next step ya tocó por dayOffset,
 * y dispara AiAgentRun(WORKFLOW_STEP) con instrucción específica del
 * paso. NV IA decide qué hacer (redactar email, agendar reunión,
 * preparar entregable, escalar al equipo).
 *
 * Las definiciones están aquí en código — son la fuente de la verdad.
 * Al crear un AiClientWorkflow se hace SNAPSHOT de los steps a la BD,
 * para que cambios en la plantilla no afecten workflows ya iniciados.
 */

export type WorkflowStep = {
  id: string;
  label: string;
  /** Días desde startedAt para que toque este paso. */
  dayOffset: number;
  /** Instrucción para NV IA — qué hacer en este paso. */
  prompt: string;
};

export type WorkflowType =
  | "onboarding_7d"
  | "onboarding_30d"
  | "renewal_30d"
  | "churn_recovery_14d";

export const WORKFLOWS: Record<WorkflowType, WorkflowStep[]> = {
  onboarding_7d: [
    {
      id: "welcome",
      label: "Email de bienvenida",
      dayOffset: 0,
      prompt:
        "Cliente recién fichado. Redacta un email de bienvenida cálido pero profesional. Incluye: agradecimiento, quién es su contacto principal, en qué consistirá el onboarding de los próximos 7 días, link a calendario para agendar kick-off. Usa workspace memory para firma estándar."
    },
    {
      id: "info_request",
      label: "Pedir info básica",
      dayOffset: 1,
      prompt:
        "Día 1 del onboarding. Si aún no tenemos: redes sociales del cliente, web, brief de marca, accesos básicos, redacta un email solicitándolos de forma estructurada (lista clara). Si ya los tenemos, marca este paso como hecho con mark_complete."
    },
    {
      id: "kickoff_meeting",
      label: "Agendar kick-off",
      dayOffset: 2,
      prompt:
        "Día 2. Propón draft_calendar_event para una reunión de kick-off de 30 min con el cliente y el gestor de cuenta (búscalo con get_team_members + get_user_memory para encontrar al gestor adecuado). Si ya hay una agendada, marca completo."
    },
    {
      id: "first_deliverable",
      label: "Primer entregable",
      dayOffset: 4,
      prompt:
        "Día 4. Revisa qué entregable inicial corresponde según el tipo de cliente y servicios contratados (busca con search_knowledge). Crea una subtarea asignada al gestor de cuenta para preparar y entregar."
    },
    {
      id: "checkin_email",
      label: "Email de seguimiento",
      dayOffset: 7,
      prompt:
        "Día 7. Redacta email de check-in preguntando cómo va el onboarding, si tiene alguna duda, y confirma siguientes pasos del mes. Cierra el workflow con mark_complete una vez enviado el draft."
    }
  ],
  onboarding_30d: [
    {
      id: "welcome",
      label: "Bienvenida",
      dayOffset: 0,
      prompt: "Email de bienvenida y plan de los próximos 30 días."
    },
    {
      id: "info_request",
      label: "Recolección de info",
      dayOffset: 2,
      prompt: "Confirma que tenemos toda la info que necesitamos. Lista de huecos."
    },
    {
      id: "strategy_doc",
      label: "Documento de estrategia",
      dayOffset: 10,
      prompt: "Prepara un draft_drive_file con la estrategia propuesta para el cliente."
    },
    {
      id: "first_results",
      label: "Primeros resultados",
      dayOffset: 21,
      prompt: "Revisa resultados de las primeras 3 semanas. Drafts: email con resumen + propuesta de ajustes."
    },
    {
      id: "review_meeting",
      label: "Reunión de revisión 30d",
      dayOffset: 30,
      prompt: "Agenda reunión de revisión del primer mes."
    }
  ],
  renewal_30d: [
    {
      id: "performance_report",
      label: "Informe de performance",
      dayOffset: 0,
      prompt:
        "Faltan 30 días para la renovación del cliente. Prepara un informe (draft_drive_file) con resultados del período: KPIs, entregables completados, ROI estimado. Usa query_knowledge_graph para sacar datos."
    },
    {
      id: "satisfaction_check",
      label: "Sondear satisfacción",
      dayOffset: 7,
      prompt: "Email de sondeo educado: '¿qué estamos haciendo bien? ¿qué mejorarías?'"
    },
    {
      id: "renewal_proposal",
      label: "Propuesta de renovación",
      dayOffset: 14,
      prompt:
        "Redacta propuesta de renovación con ajustes basados en feedback del paso anterior. Si hay upsell potencial detectado en el histórico, inclúyelo opcionalmente."
    },
    {
      id: "final_followup",
      label: "Follow-up final",
      dayOffset: 25,
      prompt: "Si aún no ha respondido a la propuesta, envía recordatorio amable."
    }
  ],
  churn_recovery_14d: [
    {
      id: "diagnosis",
      label: "Diagnóstico interno",
      dayOffset: 0,
      prompt:
        "Cliente en riesgo de churn. Investiga qué pasó en las últimas 4-8 semanas con query_knowledge_graph + get_client_memory. Identifica 3-5 hipótesis del por qué del descontento."
    },
    {
      id: "outreach",
      label: "Acercamiento personal",
      dayOffset: 1,
      prompt:
        "Redacta email o WhatsApp (lo que sea más natural según clientMemory) muy personal pidiendo una llamada de 15 min para entender. SIN venta — solo escucha."
    },
    {
      id: "post_call_action",
      label: "Acción post-llamada",
      dayOffset: 5,
      prompt:
        "Asumiendo que hubo llamada, redacta plan de acción concreto con 2-3 mejoras inmediatas. Si NO hubo llamada, notify_user al gestor para que intente contacto directo."
    },
    {
      id: "check_outcome",
      label: "Comprobar resultado",
      dayOffset: 14,
      prompt:
        "¿Recuperado o perdido? Si recuperado, actualiza clientMemory con 'churn evitado: causa X, fix Y'. Si perdido, draft_email de despedida amable + update_client_memory con la razón final."
    }
  ]
};

export function getWorkflowDefinition(type: string): WorkflowStep[] | null {
  return WORKFLOWS[type as WorkflowType] ?? null;
}
