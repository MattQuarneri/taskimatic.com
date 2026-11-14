// A generalized factory that consumes a spec and outputs Agent-ready tools
async function generateAgentTools(apiSpecUrl, credentialKey) {
  // 1. Fetch the "reflection" document (OpenAPI or Google Discovery)
  const spec = await (await fetch(apiSpecUrl)).json();
  const tools = [];

  // 2. Iterate deterministically over the defined endpoints
  for (const [methodName, details] of Object.entries(spec.methods)) {
    
    // 3. Map the API parameters to the LLM JSON Schema format
    const llmSchema = mapSpecToJSONSchema(details.parameters);

    // 4. Create the secure wrapper closure
    const execute = async (agentArguments) => {
      // Agent calls this, but we securely fetch the key from IDB at execution time
      const secureToken = await getFromIndexedDB('secure_credentials', credentialKey);
      
      const url = buildUrl(details.path, agentArguments);
      const response = await fetch(url, {
        method: details.httpMethod,
        headers: {
          'Authorization': `Bearer ${secureToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(agentArguments.bodyPayload || {})
      });
      
      return await response.json();
    };

    // 5. Package it for your agent's harness
    tools.push({
      name: methodName,
      description: details.description,
      parameters: llmSchema,
      execute: execute 
    });
  }

  return tools;
}