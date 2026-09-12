import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Node = {
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
};

type Workflow = {
  name?: string;
  description?: string;
  nodes?: Node[];
  connections?: Record<string, { main?: Array<Array<{ node: string; type: string; index: number }>> }>;
  meta?: { n8nVersion?: string };
};

type SwitchRule = {
  outputKey?: string;
  conditions?: {
    conditions?: Array<{
      leftValue?: unknown;
      rightValue?: unknown;
      operator?: { type?: unknown; operation?: unknown };
    }>;
  };
};

const workflowPath = process.argv[2] ?? join(__dirname, "..", "n8n/catalogue-qa-workflow.json");

function readWorkflow(path: string): Workflow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse workflow JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed), "workflow must be a JSON object");
  return parsed as Workflow;
}

function exactlyOne(nodes: Node[], predicate: (node: Node) => boolean, label: string): Node {
  const matches = nodes.filter(predicate);
  assert.equal(matches.length, 1, `expected exactly one ${label}, found ${matches.length}`);
  return matches[0]!;
}

function outgoing(workflow: Workflow, source: string, output: number): string[] {
  const branches = workflow.connections?.[source]?.main;
  assert.ok(branches, `missing connections for ${source}`);
  return (branches[output] ?? []).map((connection) => connection.node);
}

function assignment(node: Node, name: string): { value?: unknown; type?: string } {
  const parameters = node.parameters as { assignments?: { assignments?: Array<{ name: string; value?: unknown; type?: string }> } } | undefined;
  const found = parameters?.assignments?.assignments?.find((entry) => entry.name === name);
  assert.ok(found, `${node.name} is missing assignment ${name}`);
  return found;
}

function main(): void {
  const workflow = readWorkflow(workflowPath);
  const nodes = workflow.nodes ?? [];
  assert.equal(nodes.length, 7, "workflow must contain exactly seven nodes");

  assert.match(workflow.meta?.n8nVersion ?? "", /^1\.107\.4$/, "workflow must pin n8n 1.107.4 in metadata");
  assert.match(workflow.description ?? "", /n8n 1\.107\.4/, "workflow must document its n8n version");

  const webhook = exactlyOne(nodes, (node) => node.type === "n8n-nodes-base.webhook", "Webhook node");
  const mapper = exactlyOne(nodes, (node) => node.name === "Map Shopify payload to internal product", "Shopify mapper");
  const httpRequest = exactlyOne(nodes, (node) => node.type === "n8n-nodes-base.httpRequest", "HTTP Request node");
  const statusSwitch = exactlyOne(nodes, (node) => node.type === "n8n-nodes-base.switch", "status Switch node");
  const terminals = ["PASS", "REVIEW", "BLOCK"].map((status) =>
    exactlyOne(nodes, (node) => node.name === `Outcome ${status} (no-op)`, `${status} terminal`),
  );
  assert.equal(mapper.type, "n8n-nodes-base.set", "Shopify mapper must be a Set node");
  for (const terminal of terminals) {
    assert.equal(terminal.type, "n8n-nodes-base.set", `${terminal.name} must be a Set node`);
  }

  assert.equal(webhook.parameters?.httpMethod, "POST", "Webhook must accept POST");
  assert.equal(webhook.parameters?.responseMode, "lastNode", "Webhook must return the terminal output");
  assert.equal(httpRequest.parameters?.method, "POST", "HTTP Request must use POST");
  assert.match(String(httpRequest.parameters?.url), /127\.0\.0\.1:3000\/analyse-product/, "HTTP Request must target the local API");
  assert.match(String(httpRequest.parameters?.jsonBody), /product/, "HTTP Request body must be the {product} envelope");

  const mappingValue = String(assignment(mapper, "product").value);
  for (const requiredField of [
    "$json.body.id",
    "$json.body.title",
    "$json.body.variants[0].sku",
    "$json.body.variants[0].price",
    "$json.body.variants[0].compare_at_price",
    "$json.body.variants[0].inventory_quantity",
    "$json.body.body_html",
    "$json.body.product_type",
    "$json.body.vendor",
    "$json.body.images.map",
    "compareAtPrice",
  ]) {
    assert.match(mappingValue, new RegExp(requiredField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `mapper must explicitly map ${requiredField}`);
  }
  assert.equal(assignment(mapper, "product").type, "object", "mapper must produce a product object");

  const ruleValues = (statusSwitch.parameters?.rules as { values?: SwitchRule[] } | undefined)?.values ?? [];
  assert.deepEqual(ruleValues.map((rule) => rule.outputKey), ["PASS", "REVIEW", "BLOCK"], "Switch outputs must be PASS, REVIEW, BLOCK");
  for (const [index, status] of ["PASS", "REVIEW", "BLOCK"].entries()) {
    const conditions = ruleValues[index]?.conditions?.conditions ?? [];
    assert.equal(conditions.length, 1, `${status} Switch rule must have one comparison`);
    assert.equal(conditions[0]?.leftValue, "={{ $json.status }}", `${status} Switch rule must read $json.status`);
    assert.equal(conditions[0]?.rightValue, status, `${status} Switch rule must compare its literal status`);
    assert.deepEqual(conditions[0]?.operator, { type: "string", operation: "equals" }, `${status} Switch rule must use string equality`);
  }
  assert.deepEqual(outgoing(workflow, statusSwitch.name, 0), [terminals[0]!.name], "PASS branch must terminate at PASS no-op");
  assert.deepEqual(outgoing(workflow, statusSwitch.name, 1), [terminals[1]!.name], "REVIEW branch must terminate at REVIEW no-op");
  assert.deepEqual(outgoing(workflow, statusSwitch.name, 2), [terminals[2]!.name], "BLOCK branch must terminate at BLOCK no-op");

  assert.deepEqual(outgoing(workflow, webhook.name, 0), [mapper.name], "Webhook must feed the mapper");
  assert.deepEqual(outgoing(workflow, mapper.name, 0), [httpRequest.name], "mapper must feed the HTTP Request");
  assert.deepEqual(outgoing(workflow, httpRequest.name, 0), [statusSwitch.name], "HTTP Request must feed the status Switch");
  for (const [status, terminal] of ["PASS", "REVIEW", "BLOCK"].map((status, index) => [status, terminals[index]!] as const)) {
    assert.equal(assignment(terminal, "outcome").value, status, `${status} terminal must label its outcome`);
    assert.equal(assignment(terminal, "outcomeLabel").value, `${status} (no-op)`, `${status} terminal must expose its no-op label`);
    assert.ok(assignment(terminal, "mappedProduct").value, `${status} terminal must return mapped-product evidence`);
  }

  console.log(`n8n workflow valid: ${workflowPath}`);
  console.log("Nodes: Webhook → Shopify mapper → HTTP Request → status Switch → PASS/REVIEW/BLOCK no-op terminals");
  console.log("Pinned n8n version: 1.107.4");
}

try {
  main();
} catch (error) {
  console.error(`n8n workflow validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
