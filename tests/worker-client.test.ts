import { strict as assert } from "node:assert";
import { afterEach, beforeEach, test } from "node:test";
import { SimplicialModel } from "../core/model.js";
import { createTopologyInput } from "../core/topology/chain-complex.js";
import { TopologyWorkerClient } from "../core/topology/worker-client.js";
import { createTopologyRequestHandler } from "../core/topology/worker-entry.js";
import { DEFAULT_TOPOLOGY_LIMITS, type TopologyWorkerResponse } from "../core/topology/worker-protocol.js";

/**
 * Exercises the *worker* path of the client, which Node cannot otherwise reach: there is
 * no global `Worker`, so without a stub every test would silently take the main-thread
 * fallback and the blob plumbing would go unexercised.
 *
 * This is not a substitute for a clean-install check in Obsidian. It verifies the code in
 * this repository — blob construction, protocol round-trip, cancellation forwarding,
 * restart and URL cleanup. Whether `new Worker(blobURL)` is permitted by the CSP of a
 * given Electron build or mobile webview is a property of that host, not of this code,
 * and only an install can answer it.
 */
interface StubRecord {
  created: number;
  terminated: number;
  transferred: number[];
  revoked: string[];
  urls: string[];
  received: string[];
}

let stub: StubRecord;
const saved: Record<string, unknown> = {};

class StubWorker {
  onmessage: ((event: { data: TopologyWorkerResponse }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private handle = createTopologyRequestHandler((message) => {
    // Out-of-process delivery is never synchronous.
    setTimeout(() => this.onmessage?.({ data: message }), 0);
  });

  constructor(readonly url: string) {
    stub.created++;
  }

  postMessage(request: unknown, transfer?: unknown[]): void {
    stub.received.push((request as { kind: string }).kind);
    if (transfer) stub.transferred.push(transfer.length);
    setTimeout(() => this.handle(request as never), 0);
  }

  terminate(): void {
    stub.terminated++;
  }
}

beforeEach(() => {
  stub = { created: 0, terminated: 0, transferred: [], revoked: [], urls: [], received: [] };
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const key of ["Worker", "__TOPOLOGY_WORKER_SOURCE__"]) saved[key] = globals[key];
  globals.Worker = StubWorker;
  // The build replaces this identifier with the bundled worker source; nothing defines it
  // under the test compiler, which is exactly why the fallback exists.
  globals.__TOPOLOGY_WORKER_SOURCE__ = "/* bundled worker */";

  saved.createObjectURL = URL.createObjectURL;
  saved.revokeObjectURL = URL.revokeObjectURL;
  let counter = 0;
  URL.createObjectURL = ((blob: Blob) => {
    assert.equal(blob.type, "text/javascript", "the worker blob must be typed as JavaScript");
    const url = `blob:stub/${++counter}`;
    stub.urls.push(url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    stub.revoked.push(url);
  }) as typeof URL.revokeObjectURL;
});

afterEach(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const key of ["Worker", "__TOPOLOGY_WORKER_SOURCE__"]) globals[key] = saved[key];
  URL.createObjectURL = saved.createObjectURL as typeof URL.createObjectURL;
  URL.revokeObjectURL = saved.revokeObjectURL as typeof URL.revokeObjectURL;
});

function inputFor(requestId: string) {
  const model = new SimplicialModel();
  ["a", "b", "c"].forEach((id) => model.setNode(id));
  [
    ["a", "b"],
    ["b", "c"],
    ["c", "a"],
  ].forEach((nodes) => model.addSimplex({ nodes, weight: 1 }));
  return createTopologyInput(model, requestId, { maxHomologyDimension: 2, computeRepresentatives: true });
}

function runOnce(client: TopologyWorkerClient, requestId: string): Promise<TopologyWorkerResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker never replied")), 5000);
    client.send(
      { kind: "persistence", requestId, input: inputFor(requestId), limits: DEFAULT_TOPOLOGY_LIMITS },
      {
        onMessage: (message) => {
          if (message.kind === "progress") return;
          clearTimeout(timer);
          resolve(message);
        },
      },
    );
  });
}

test("the client starts one blob worker and round-trips a result through it", async () => {
  const client = new TopologyWorkerClient();
  try {
    const message = await runOnce(client, "r1");
    assert.equal(message.kind, "persistence-result");
    assert.equal(client.lastExecution, "worker", "it must not silently fall back when a Worker exists");
    assert.equal(stub.created, 1);
    assert.equal(stub.urls.length, 1, "the worker is started from a Blob URL, not a file path");

    // The snapshot's buffers are handed over rather than copied.
    assert.deepEqual(stub.transferred, [4]);

    await runOnce(client, "r2");
    assert.equal(stub.created, 1, "one live worker is reused across requests");
  } finally {
    client.dispose();
  }
});

test("a cancel is forwarded to the worker without destroying it", async () => {
  const client = new TopologyWorkerClient();
  try {
    const settled = new Promise<TopologyWorkerResponse>((resolve) => {
      client.send(
        { kind: "persistence", requestId: "c1", input: inputFor("c1"), limits: DEFAULT_TOPOLOGY_LIMITS },
        {
          onMessage: (message) => {
            if (message.kind !== "progress") resolve(message);
          },
        },
      );
    });
    client.cancel("c1");
    await settled;

    assert.deepEqual(stub.received, ["persistence", "cancel"], "the cancel goes to the worker as a message");
    assert.equal(stub.terminated, 0, "cooperative cancellation must not destroy the worker");
    // This fixture reduces in well under the yield interval, so it legitimately finishes
    // before the cancel is dequeued. That is harmless: the service discards a superseded
    // result through its stale-request guard. Whether a *long* reduction can observe a
    // late cancel at all is a property of the reduction, tested in persistence.test.ts.
  } finally {
    client.dispose();
  }
});

test("a restart terminates the worker, revokes its URL, and the next request still works", async () => {
  const client = new TopologyWorkerClient();
  try {
    await runOnce(client, "r1");
    client.restart();

    assert.equal(stub.terminated, 1);
    assert.deepEqual(stub.revoked, stub.urls, "the object URL is revoked rather than leaked");
    assert.equal(client.restarts, 1);

    const message = await runOnce(client, "r2");
    assert.equal(message.kind, "persistence-result", "a hard restart leaves the client usable");
    assert.equal(stub.created, 2, "the next request starts a fresh worker");
  } finally {
    client.dispose();
  }
});

test("dispose leaves no worker running and no URL outstanding", async () => {
  const client = new TopologyWorkerClient();
  await runOnce(client, "r1");
  client.dispose();

  assert.equal(stub.terminated, 1, "a plugin unload or vault switch must not orphan a worker");
  assert.deepEqual(stub.revoked, stub.urls);
});

test("without a bundled worker source the client falls back and says so", async () => {
  (globalThis as unknown as Record<string, unknown>).__TOPOLOGY_WORKER_SOURCE__ = "";
  const client = new TopologyWorkerClient();
  try {
    const message = await runOnce(client, "f1");
    assert.equal(message.kind, "persistence-result", "the analysis still completes");
    assert.equal(client.lastExecution, "main-thread");
    assert.equal(stub.created, 0, "no worker was started");
  } finally {
    client.dispose();
  }
});

test("a worker that cannot be constructed degrades to the main thread", async () => {
  (globalThis as unknown as Record<string, unknown>).Worker = class {
    constructor() {
      throw new Error("blocked by content security policy");
    }
  };
  const client = new TopologyWorkerClient();
  try {
    const message = await runOnce(client, "csp1");
    assert.equal(message.kind, "persistence-result");
    assert.equal(client.lastExecution, "main-thread", "a blocked worker is reported, not fatal");
  } finally {
    client.dispose();
  }
});
