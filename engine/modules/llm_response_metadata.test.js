const test = require('node:test');
const assert = require('node:assert/strict');
const { extractReasoningContent, extractReasoningChunkText, extractContentChunkText } = require('./llm_response_metadata.js');

test('extracts OpenAI-compatible reasoning from additional kwargs', () => {
  assert.equal(extractReasoningContent({
    additional_kwargs: { reasoning: 'Careful hidden work' }
  }), 'Careful hidden work');
});

test('supports alternate provider reasoning fields', () => {
  const details = [{ type: 'reasoning.text', text: 'Step one' }];
  assert.deepEqual(extractReasoningContent({
    additional_kwargs: { reasoning_details: details }
  }), details);
  assert.equal(extractReasoningContent({
    response_metadata: { reasoning_content: 'Step two' }
  }), 'Step two');
});

test('extracts OpenRouter reasoning retained in LangChain raw responses', () => {
  assert.equal(extractReasoningContent({
    additional_kwargs: {
      __raw_response: {
        choices: [{ message: { reasoning: 'Raw OpenRouter reasoning' } }]
      }
    }
  }), 'Raw OpenRouter reasoning');
});

test('extracts reasoning content blocks without treating answer blocks as reasoning', () => {
  const reasoning = extractReasoningContent({
    content: [
      { type: 'reasoning', text: 'Think' },
      { type: 'text', text: 'Answer' }
    ]
  });
  assert.deepEqual(reasoning, [{ type: 'reasoning', text: 'Think' }]);
});

test('returns null when no meaningful reasoning was returned', () => {
  assert.equal(extractReasoningContent({ additional_kwargs: { reasoning: '  ' } }), null);
  assert.equal(extractReasoningContent({ content: 'Answer only' }), null);
});

test('extracts reasoning text from streaming chunk shapes', () => {
  assert.equal(
    extractReasoningChunkText({ additional_kwargs: { reasoning_content: 'step one' } }),
    'step one'
  );
  assert.equal(
    extractReasoningChunkText({ response_metadata: { reasoning: 'step two' } }),
    'step two'
  );
  assert.equal(
    extractReasoningChunkText({ additional_kwargs: { reasoning: { type: 'reasoning', summary: [{ text: 'delta one' }] } } }),
    'delta one'
  );
  // Chat-completions transport: LangChain drops delta.reasoning_content, but
  // the raw SSE payload survives on __includeRawResponse.
  assert.equal(
    extractReasoningChunkText({
      additional_kwargs: {
        __raw_response: { choices: [{ delta: { reasoning_content: 'raw thought' } }] }
      }
    }),
    'raw thought'
  );
  assert.equal(
    extractReasoningChunkText({
      additional_kwargs: {
        __raw_response: { choices: [{ delta: { reasoning_details: [{ text: 'a' }, { text: 'b' }] } }] }
      }
    }),
    'ab'
  );
  assert.equal(extractReasoningChunkText({ text: 'visible' }), '');
  assert.equal(extractReasoningChunkText(null), '');
});

test('extracts visible text from streaming chunk shapes', () => {
  assert.equal(extractContentChunkText({ text: 'Hello ' }), 'Hello ');
  assert.equal(extractContentChunkText({ content: 'world' }), 'world');
  assert.equal(extractContentChunkText({ additional_kwargs: { reasoning_content: 'hidden' } }), '');
});
