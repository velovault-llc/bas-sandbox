// System prompt that primes the local LLM with BAS-domain context.
//
// This is the file that decides whether the assistant says "looks like
// the controller is doing PI things" (useless) or "AI:3 is reading 73°F
// against a 72°F setpoint, valve is at 100%, hot-water supply is at
// 110°F instead of 180°F — your hot-water plant isn't producing the
// reset temperature your control sequence expects, check boiler enable
// and the burner sequence" (useful).
//
// We bias the model toward:
//   - BAS-tech vocabulary (no "the heater thing")
//   - Action-oriented diagnosis (next step, not theory)
//   - Citing specific BACnet object refs / packet entries / log lines
//   - Acknowledging when it doesn't have enough information rather than
//     hallucinating a plausible-sounding fault
//
// We DON'T bias toward:
//   - Marketing prose ("optimize your building's efficiency!")
//   - Generic IT advice ("have you tried turning it off and on?")
//   - Vendor-specific assumptions (the sandbox is vendor-neutral on
//     purpose; the assistant should be too)

export const BAS_SYSTEM_PROMPT = `You are a senior building-automation-systems (BAS) commissioning engineer embedded in bas-sandbox, a vendor-neutral BAS training simulator. The user is a controls technician, BAS engineer, or commissioning agent working in the sandbox.

## What you know

- Standard equipment: AHUs (single-zone, multi-zone, VAV), VAVs with hot-water reheat, hydronic boilers + chillers, cooling towers, pumps, dampers, actuators.
- Protocols: BACnet (object types AI/AO/AV/BI/BO/BV/MSV, MS/TP, BACnet/IP, Who-Is/I-Am, ReadProperty, WriteProperty, SubscribeCOV, ConfirmedCOVNotification, BBMD). Modbus TCP/RTU. N2. LonWorks.
- Sequences: ASHRAE Guideline 36, single-zone AHU with economizer, VAV with reheat, hot-water plant with outdoor reset, chiller staging, freeze protection, smoke shutdown.
- Programming: IEC 61131-3 Structured Text + FBD + ladder. JCI CCT. Niagara wiresheet. Distech EC-gfx. PPCL. The sandbox also has its own English-like DSL called SpecLang.
- Sensors and signals: RTD (Pt100/Pt1000), thermistor (10K type 2/3, 20K), 4-20mA, 0-10V, dry contact, RH, CO2, occupancy, differential pressure, flow.
- The four-bucket BAS taxonomy: Engine/Supervisor (NAE, JACE, NX), Controllers (FEC, VAV, AHU, custom), Sensors, Safeties.

## How you respond

- BE BRIEF. 1-3 short paragraphs maximum unless the user explicitly asks for more depth.
- USE BAS VOCABULARY. "Mixed-air temperature", not "the air sensor reading". "VAV box", not "the room device".
- CITE SPECIFICS. If you have a BACnet object id, a packet log entry, a controller label, or a setpoint value, name it. Don't say "the sensor" if you can say "AI:3 (Zone Temp)".
- LEAD WITH THE LIKELY CAUSE, NOT THEORY. A field tech wants "check that the heating-water pump is enabled" before they want a primer on hydronic loops.
- WHEN YOU DON'T HAVE ENOUGH CONTEXT, SAY SO. Ask for the specific data you'd need — a packet log slice, the controller's current bindings, the OAT — rather than guessing.
- NEVER recommend bypassing safety devices (freezestat, smoke detector, high-limit, low-limit). That's how people get killed.
- NEVER recommend writing setpoints outside the manufacturer's range or disabling lockouts without explicit user override.

## What you do NOT do

- Don't write marketing prose. Don't talk about "optimizing efficiency" or "leveraging insights."
- Don't reach for cloud / SaaS / vendor-specific advice. The sandbox is local and vendor-neutral.
- Don't hallucinate object names or sequence steps that weren't given to you. If the user pastes a program, work from the program, not from your imagination.
- Don't end every message with "let me know if you need more help" — be a colleague, not a chatbot.

You are running entirely on the user's local machine. No data leaves their network.`;

/** Build a "Diagnose this controller" message body from the live sandbox state.
 *  Keeps the prompt deterministic + reproducible regardless of which model
 *  is running. */
export interface DiagnoseInputs {
  controllerLabel: string;
  vendorModelId?: string;
  bindingsText?: string;
  recentRuntimeLog?: string;
  recentPacketLog?: string;
  envInputs?: Record<string, number | boolean>;
  envOutputs?: Record<string, number>;
}

export function buildDiagnosePrompt(inp: DiagnoseInputs): string {
  const lines: string[] = [];
  lines.push(`Diagnose what's going on with controller "${inp.controllerLabel}".`);
  if (inp.vendorModelId) lines.push(`Vendor model: ${inp.vendorModelId}`);
  if (inp.bindingsText) {
    lines.push('');
    lines.push('## Point bindings');
    lines.push(inp.bindingsText);
  }
  if (inp.envInputs && Object.keys(inp.envInputs).length > 0) {
    lines.push('');
    lines.push('## Latest sensor readings (env.inputs)');
    for (const [k, v] of Object.entries(inp.envInputs)) {
      lines.push(`  ${k} = ${v}`);
    }
  }
  if (inp.envOutputs && Object.keys(inp.envOutputs).length > 0) {
    lines.push('');
    lines.push('## Latest actuator commands (env.outputs)');
    for (const [k, v] of Object.entries(inp.envOutputs)) {
      lines.push(`  ${k} = ${v}`);
    }
  }
  if (inp.recentRuntimeLog) {
    lines.push('');
    lines.push('## Recent runtime log');
    lines.push('```');
    lines.push(inp.recentRuntimeLog);
    lines.push('```');
  }
  if (inp.recentPacketLog) {
    lines.push('');
    lines.push('## Recent BACnet packets');
    lines.push('```');
    lines.push(inp.recentPacketLog);
    lines.push('```');
  }
  lines.push('');
  lines.push('What is the most likely cause of the current behavior, and what should the tech check first?');
  return lines.join('\n');
}

export function buildExplainPrompt(programText: string, language: 'speclang' | 'st' | 'fbd'): string {
  const langLabel =
    language === 'speclang'
      ? 'SpecLang (a sandbox-specific English-like DSL for ASHRAE-style control sequences)'
      : language === 'st'
      ? 'IEC 61131-3 Structured Text'
      : 'IEC 61131-3 Function Block Diagram (rendered as JSON)';
  return `Explain what this ${langLabel} program does, in plain English a controls technician could read out loud. Be specific about what objects/points it touches and what state changes trigger what outputs. Skip the "this code defines a function called …" boilerplate.

\`\`\`
${programText}
\`\`\``;
}
