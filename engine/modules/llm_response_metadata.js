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

function reasoningSummaryText(value) {
  // Responses-API reasoning arrives as { type:'reasoning', summary:[{text}] }.
  if (!value || typeof value !== 'object') return '';
  const summaries = Array.isArray(value.summary) ? value.summary : [];
  const texts = [];
  for (const entry of summaries) {
    if (typeof entry?.text === 'string' && entry.text) texts.push(entry.text);
    if (Array.isArray(entry?.summary)) {
      for (const inner of entry.summary) {
        if (typeof inner?.text === 'string' && inner.text) texts.push(inner.text);
      }
    }
  }
  return texts.join('');
}

/**
 * Streaming reasoning text. LangChain's chat-completions path drops
 * `delta.reasoning_content`, but `__includeRawResponse` keeps the raw SSE
 * payload on every chunk, so the same shapes used for full responses are read
 * back from `choices[0].delta` here.
 */
function rawDeltaReasoningText(delta) {
  if (!delta || typeof delta !== 'object') return '';
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) return delta.reasoning_content;
  if (typeof delta.reasoning === 'string' && delta.reasoning) return delta.reasoning;
  if (Array.isArray(delta.reasoning_details)) {
    const joined = delta.reasoning_details
      .map(entry => (typeof entry?.text === 'string' ? entry.text : ''))
      .join('');
    if (joined) return joined;
  }
  if (typeof delta.reasoning_details === 'string' && delta.reasoning_details) return delta.reasoning_details;
  return '';
}

function extractReasoningChunkText(chunk) {
  if (!chunk || typeof chunk !== 'object') return '';
  // A streaming delta arrives as a ChatGenerationChunk: the message payload
  // (and therefore additional_kwargs) lives on `chunk.message`, while
  // `chunk.text` is the visible token.
  const message = chunk.message && typeof chunk.message === 'object' ? chunk.message : chunk;
  const kwargs = message.additional_kwargs || {};
  const kwargsText = typeof kwargs.reasoning_content === 'string' ? kwargs.reasoning_content
    : typeof kwargs.reasoning === 'string' ? kwargs.reasoning
    : typeof kwargs.reasoning_details === 'string' ? kwargs.reasoning_details
    : reasoningSummaryText(kwargs.reasoning);
  const meta = message.response_metadata || {};
  const metaText = typeof meta.reasoning_content === 'string' ? meta.reasoning_content
    : typeof meta.reasoning === 'string' ? meta.reasoning
    : typeof meta.reasoning_details === 'string' ? meta.reasoning_details
    : reasoningSummaryText(meta.reasoning);
  const directText = typeof message.reasoning_content === 'string' ? message.reasoning_content
    : typeof message.reasoning === 'string' ? message.reasoning
    : typeof kwargs.__raw_delta?.reasoning_content === 'string' ? kwargs.__raw_delta.reasoning_content : '';
  // Reasoning deltas must never leak into the visible content stream.
  const rawText = rawDeltaReasoningText(kwargs.__raw_response?.choices?.[0]?.delta);
  return kwargsText || metaText || directText || rawText;
}

function extractContentChunkText(chunk) {
  if (!chunk || typeof chunk !== 'object') return '';
  if (typeof chunk.text === 'string') return chunk.text;
  const message = chunk.message && typeof chunk.message === 'object' ? chunk.message : chunk;
  if (typeof message.text === 'string') return message.text;
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map(block => (typeof block === 'string' ? block : typeof block?.text === 'string' ? block.text : ''))
      .join('');
  }
  return '';
}

module.exports = { extractReasoningContent, extractReasoningChunkText, extractContentChunkText, isMeaningfulReasoning };
