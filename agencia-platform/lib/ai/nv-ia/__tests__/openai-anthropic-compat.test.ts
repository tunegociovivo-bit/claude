import { describe, expect, it } from "vitest";
import { anthropicParamsToOpenAi, isAnthropicBillingError, openAiResponseToAnthropic } from "../openai-anthropic-compat";

describe("Sonia OpenAI fallback", () => {
  it("conserva llamadas y resultados de tools al cambiar de proveedor", () => {
    const body = anthropicParamsToOpenAi({
      model: "claude-test",
      max_tokens: 500,
      system: "Eres Sonia",
      tools: [{ name: "create_file", description: "crea", input_schema: { type: "object", properties: {} } }],
      messages: [
        { role: "user", content: "Crea el informe" },
        { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "create_file", input: { name: "leads.xlsx" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }] }
      ]
    } as any);
    expect(body.model).toBe("gpt-5");
    expect(body.messages).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "tool-1", content: "ok" }));
    expect(body.tools?.[0].function.name).toBe("create_file");
  });

  it("convierte tool calls de OpenAI al formato que consume el runner", () => {
    const result = openAiResponseToAnthropic({
      id: "chat-1", model: "gpt-5", usage: { prompt_tokens: 10, completion_tokens: 5 },
      choices: [{ message: { content: null, tool_calls: [{ id: "call-1", function: { name: "add_comment", arguments: '{"body":"listo"}' } }] } }]
    });
    expect(result.stop_reason).toBe("tool_use");
    expect(result.content[0]).toMatchObject({ type: "tool_use", name: "add_comment", input: { body: "listo" } });
  });

  it("detecta el error real de saldo de Anthropic", () => {
    expect(isAnthropicBillingError(new Error("Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing"))).toBe(true);
  });

  it("limita el catálogo a 128 tools y conserva las necesarias para entregar leads", () => {
    const tools = Array.from({ length: 184 }, (_, index) => ({
      name: `tool_${index}`,
      description: `Tool ${index}`,
      input_schema: { type: "object", properties: {} }
    })) as any[];
    tools[160] = { name: "meta_ads_download_leads", description: "Meta leads", input_schema: { type: "object" } };
    tools[170] = { name: "create_xlsx_workbook", description: "Excel", input_schema: { type: "object" } };
    tools[180] = { name: "draft_whatsapp_file", description: "WhatsApp file", input_schema: { type: "object" } };

    const body = anthropicParamsToOpenAi({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "crea y envía el Excel" }],
      tools
    } as any);

    expect(body.tools).toHaveLength(128);
    const names = body.tools?.map((tool: any) => tool.function.name);
    expect(names).toContain("meta_ads_download_leads");
    expect(names).toContain("create_xlsx_workbook");
    expect(names).toContain("draft_whatsapp_file");
  });
});
