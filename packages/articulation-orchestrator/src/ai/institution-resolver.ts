import { ConverseCommand, type BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import type { InstitutionResolver } from '../catalog/catalog-key-resolver.js';

const SelectionSchema = z.object({ institution: z.string().min(1).or(z.literal('none')) }).strict();

/** Uses Bedrock only after exact catalog institution matching has failed. */
export class BedrockInstitutionResolver implements InstitutionResolver {
  public constructor(private readonly client: Pick<BedrockRuntimeClient, 'send'>, private readonly modelId: string) {}

  public async resolveInstitution(input: { institution: string; knownInstitutions: string[] }): Promise<string | 'none'> {
    if (input.knownInstitutions.length === 0) return 'none';
    const response = await this.client.send(new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: 'Choose exactly one supplied catalog institution that refers to the input institution, or none. Use the required tool only.' }],
      messages: [{ role: 'user', content: [{ text: JSON.stringify(input) }] }],
      toolConfig: { tools: [{ toolSpec: {
        name: 'select_institution', description: 'Select a known institution or none.',
        inputSchema: { json: { type: 'object', additionalProperties: false, required: ['institution'], properties: { institution: { type: 'string', enum: [...input.knownInstitutions, 'none'] } } } },
      } }], toolChoice: { tool: { name: 'select_institution' } } },
    }));
    const toolUse = response.output?.message?.content?.find((block) => 'toolUse' in block)?.toolUse;
    const selection = SelectionSchema.safeParse(toolUse?.name === 'select_institution' ? toolUse.input : undefined);
    if (!selection.success || (selection.data.institution !== 'none' && !input.knownInstitutions.includes(selection.data.institution))) {
      throw new Error('Institution selection was invalid');
    }
    return selection.data.institution;
  }
}
