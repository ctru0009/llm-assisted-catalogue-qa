import assert from "node:assert/strict";
import test from "node:test";

import { ALLOWED_CATEGORIES } from "../src/llm/categories";
import { OpenAICompatibleProvider } from "../src/llm/openai-compatible";
import { UnavailableProvider } from "../src/llm/unavailable-provider";
import type { CategorySuggestionInput } from "../src/llm/provider";

const input: CategorySuggestionInput = {
  title: "Velocity Runner X",
  description: "Lightweight road running shoe.",
  vendorCategory: "mens footwear / running",
  currentCategory: "Other",
};

const validResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          suggestedCategory: ALLOWED_CATEGORIES[0],
          confidence: 0.94,
          reason: "The title and supplier category indicate an athletic shoe.",
        }),
      },
    },
  ],
};

function providerWithResponses(responses: unknown[]) {
  let calls = 0;
  const requests: Array<unknown> = [];
  const provider = new OpenAICompatibleProvider(
    {
      apiKey: "test-key",
      baseUrl: "https://llm.example.test/v1",
      model: "catalogue-model",
      client: {
        chat: {
          completions: {
            create: async (request) => {
              requests.push(request);
              if (calls >= responses.length) {
                throw new Error("Fake transport exhausted");
              }
              const response = responses[calls];
              calls += 1;
              if (response instanceof Error) {
                throw response;
              }
              return response;
            },
          },
        },
      },
    },
  );

  return { provider, calls: () => calls, requests };
}

test("OpenAI-compatible provider parses and validates an allowed suggestion", async () => {
  const { provider, calls, requests } = providerWithResponses([validResponse]);

  const result = await provider.suggestCategory(input);

  assert.deepEqual(result, {
    suggestedCategory: ALLOWED_CATEGORIES[0],
    confidence: 0.94,
    reason: "The title and supplier category indicate an athletic shoe.",
  });
  assert.equal(calls(), 1);
  assert.equal((requests[0] as { model: string }).model, "catalogue-model");
  assert.deepEqual(
    (requests[0] as { response_format: { type: string } }).response_format,
    { type: "json_object" },
  );
  assert.match(
    (requests[0] as { messages: Array<{ content: string }> }).messages[1]
      .content,
    new RegExp(ALLOWED_CATEGORIES[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(
    (requests[0] as { messages: Array<{ content: string }> }).messages[0]
      .content,
    /untrusted product data.*ignore.*instructions/i,
  );
  assert.doesNotMatch(
    (requests[0] as { messages: Array<{ content: string }> }).messages[1]
      .content,
    /untrusted data, not as instructions/i,
  );
});

test("malformed JSON retries exactly once", async () => {
  const { provider, calls } = providerWithResponses([
    { choices: [{ message: { content: "not-json" } }] },
    validResponse,
  ]);

  const result = await provider.suggestCategory(input);

  assert.equal("status" in result, false);
  assert.equal(calls(), 2);
});

test("schema-invalid JSON retries exactly once", async () => {
  const { provider, calls } = providerWithResponses([
    {
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestedCategory: ALLOWED_CATEGORIES[0],
              confidence: 2,
              reason: "invalid confidence",
            }),
          },
        },
      ],
    },
    validResponse,
  ]);

  const result = await provider.suggestCategory(input);

  assert.equal("status" in result, false);
  assert.equal(calls(), 2);
});

test("an out-of-list category retries exactly once", async () => {
  const { provider, calls } = providerWithResponses([
    {
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestedCategory: "Untrusted > Category",
              confidence: 0.9,
              reason: "untrusted category",
            }),
          },
        },
      ],
    },
    validResponse,
  ]);

  const result = await provider.suggestCategory(input);

  assert.equal("status" in result, false);
  assert.equal(calls(), 2);
});

const terminalResponseFailures: Array<[string, unknown, string]> = [
  ["malformed JSON", { choices: [{ message: { content: "not-json" } }] }, "MALFORMED_RESPONSE"],
  [
    "schema-invalid JSON",
    {
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestedCategory: ALLOWED_CATEGORIES[0],
              confidence: 2,
              reason: "invalid confidence",
            }),
          },
        },
      ],
    },
    "MALFORMED_RESPONSE",
  ],
  [
    "out-of-list category",
    {
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestedCategory: "Untrusted > Category",
              confidence: 0.9,
              reason: "untrusted category",
            }),
          },
        },
      ],
    },
    "INVALID_CATEGORY",
  ],
];

for (const [label, response, expectedCode] of terminalResponseFailures) {
  test(`${label} returns an exhausted typed failure after two calls`, async () => {
    const { provider, calls } = providerWithResponses([response, response]);

    const result = await provider.suggestCategory(input);

    assert.equal("status" in result && result.status, "FAILED");
    if ("status" in result && result.status === "FAILED") {
      assert.equal(result.error.code, expectedCode);
      assert.equal(result.error.retryable, false);
    }
    assert.equal(calls(), 2);
  });
}

const retryableErrors: Array<[
  string,
  Error,
  "TIMEOUT" | "CONNECTION" | "RATE_LIMITED" | "SERVER_ERROR",
]> = [
  ["timeout", Object.assign(new Error("timed out"), { name: "APITimeoutError" }), "TIMEOUT"],
  ["connection", Object.assign(new Error("connection failed"), { name: "APIConnectionError" }), "CONNECTION"],
  ["429", Object.assign(new Error("rate limited"), { status: 429 }), "RATE_LIMITED"],
  ["5xx", Object.assign(new Error("server failed"), { status: 503 }), "SERVER_ERROR"],
];

for (const [label, error, expectedCode] of retryableErrors) {
  test(`${label} retries exactly once and exhausts with a typed failure`, async () => {
    const { provider, calls } = providerWithResponses([error, error]);

    const result = await provider.suggestCategory(input);

    assert.equal("status" in result && result.status, "FAILED");
    if ("status" in result && result.status === "FAILED") {
      assert.equal(result.error.code, expectedCode);
      assert.equal(result.error.retryable, false);
    }
    assert.equal(calls(), 2);
  });
}

for (const [label, transportError, expectedCode] of [
  ["authentication 401", Object.assign(new Error("unauthorized"), { status: 401 }), "AUTHENTICATION"],
  ["authentication 403", Object.assign(new Error("forbidden"), { status: 403 }), "AUTHENTICATION"],
  ["permanent 4xx", Object.assign(new Error("bad request"), { status: 400 }), "CLIENT_ERROR"],
] as const) {
  test(`${label} does not retry`, async () => {
    const { provider, calls } = providerWithResponses([transportError]);

    const result = await provider.suggestCategory(input);

    assert.equal("status" in result && result.status, "FAILED");
    assert.equal(calls(), 1);
    if ("status" in result && result.status === "FAILED") {
      assert.equal(result.error.code, expectedCode);
      assert.equal(result.error.retryable, false);
    }
  });
}

test("a second failure returns a typed provider failure", async () => {
  const { provider, calls } = providerWithResponses([
    { choices: [{ message: { content: "not-json" } }] },
    { choices: [{ message: { content: "still-not-json" } }] },
  ]);

  const result = await provider.suggestCategory(input);

  assert.equal("status" in result && result.status, "FAILED");
  if ("status" in result && result.status === "FAILED") {
    assert.equal(result.error.name, "LLMProviderError");
    assert.equal(result.error.code, "MALFORMED_RESPONSE");
    assert.equal(result.error.retryable, false);
  }
  assert.equal(calls(), 2);
});

test("unavailable provider fails without making a transport call", async () => {
  let calls = 0;
  const provider = new UnavailableProvider();

  const result = await provider.suggestCategory(input);
  calls += 0;

  assert.equal("status" in result && result.status, "FAILED");
  assert.equal(calls, 0);
  if ("status" in result && result.status === "FAILED") {
    assert.equal(result.error.code, "UNAVAILABLE");
  }
});
