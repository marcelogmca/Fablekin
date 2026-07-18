function isMeaningfulReasoning(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function extractReasoningContent(response) {
  if (!response || typeof response !== 'object') return null;

  const additionalKwargs = response.additional_kwargs || response.lc_kwargs?.additional_kwargs || {};
  const responseMetadata = response.response_metadata || {};
  const rawMessage = additionalKwargs.__raw_response?.choices?.[0]?.message || {};
  const candidates = [
    additionalKwargs.reasoning,
    additionalKwargs.reasoning_content,
    additionalKwargs.reasoning_details,
    responseMetadata.reasoning,
    responseMetadata.reasoning_content,
    responseMetadata.reasoning_details,
    response.reasoning,
    response.reasoning_content,
    response.reasoning_details,
    rawMessage.reasoning,
    rawMessage.reasoning_content,
    rawMessage.reasoning_details
  ];

  for (const candidate of candidates) {
    if (isMeaningfulReasoning(candidate)) return candidate;
  }

  if (Array.isArray(response.content)) {
    const reasoningBlocks = response.content.filter(block => {
      const type = String(block?.type || block?.name || '').toLowerCase();
      return type.includes('reasoning') || type.includes('thinking');
    });
    if (reasoningBlocks.length > 0) return reasoningBlocks;
  }

  return null;
}

module.exports = { extractReasoningContent, isMeaningfulReasoning };
