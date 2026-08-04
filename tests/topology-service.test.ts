import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SimplicialModel } from "../core/model.js";
import {
  DEFAULT_ANALYSIS_CONFIG,
  TopologyAnalysisService,
  type TopologyAnalysisConfig,
  type TopologyAnalysisState,
} from "../core/topology/analysis-service.js";
import { DEFAULT_BOOTSTRAP_CONFIG } from "../core/topology/bootstrap.js";

/**
 * Node has no `Worker`, so these exercise the main-thread fallback. That is the point:
 * the fallback runs the same engine through the same request handler, so the service's
 * cancellation, staleness and failure behaviour is what is under test here, not the
 * transport underneath it.
 */
function modelOf(): SimplicialModel {
  const model = new SimplicialModel();
  ["a", "b", "c", "d"].forEach((id) => model.setNode(id));
  [
    ["a", "b"],
    ["b", "c"],
    ["c", "d"],
    ["d", "a"],
  ].forEach((nodes) => model.addSimplex({ nodes, weight: 1 }));
  return model;
}

function config(overrides: Partial<TopologyAnalysisConfig> = {}): TopologyAnalysisConfig {
  return { ...DEFAULT_ANALYSIS_CONFIG, bootstrap: { ...DEFAULT_BOOTSTRAP_CONFIG }, ...overrides };
}

/** Resolves on the first state matching the predicate. */
function until(
  service: TopologyAnalysisService,
  predicate: (state: TopologyAnalysisState) => boolean,
): Promise<TopologyAnalysisState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("timed out waiting for topology state"));
    }, 5000);
    const unsubscribe = service.subscribe((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      // Defer so the service finishes its own emit loop before we unsubscribe.
      queueMicrotask(unsubscribe);
      resolve(state);
    });
  });
}

test("a request reaches a result and reports where it ran", async () => {
  const service = new TopologyAnalysisService(modelOf());
  try {
    const ready = until(service, (state) => state.status === "ready");
    service.request(config());
    const state = await ready;
    assert.ok(state.result);
    assert.equal(state.result.coefficientField, "F2");
    assert.equal(state.result.intervals.filter((interval) => interval.dimension === 1).length, 1);
    assert.equal(state.execution, "main-thread", "no Worker exists here, and the service says so");
  } finally {
    service.dispose();
  }
});

test("an identical second request is served from cache without recomputing", async () => {
  const model = modelOf();
  const service = new TopologyAnalysisService(model);
  try {
    const ready = until(service, (state) => state.status === "ready");
    service.request(config());
    const first = await ready;

    let sawRunning = false;
    const unsubscribe = service.subscribe((state) => {
      if (state.status === "running") sawRunning = true;
    });
    service.request(config());
    unsubscribe();

    assert.equal(sawRunning, false, "a cache hit must not re-enter the running state");
    assert.equal(service.getState().result, first.result, "the cached result is the same object");
  } finally {
    service.dispose();
  }
});

test("the cache key separates every input that can change a pairing", () => {
  const model = modelOf();
  const service = new TopologyAnalysisService(model);
  try {
    const base = service.cacheKey(config());
    assert.notEqual(base, service.cacheKey(config({ metric: "confidence" })));
    assert.notEqual(base, service.cacheKey(config({ maxHomologyDimension: 1 })));
    assert.notEqual(base, service.cacheKey(config({ computeRepresentatives: false })));
    assert.notEqual(
      base,
      service.cacheKey(config({ bootstrap: { ...DEFAULT_BOOTSTRAP_CONFIG, enabled: true } })),
      "enabling uncertainty changes the result and must not reuse the entry",
    );
    assert.ok(base.includes("filtration-order-v1"), "the tie policy is part of the key");

    model.addSimplex({ nodes: ["a", "c"], weight: 1 });
    assert.notEqual(base, service.cacheKey(config()), "a model revision invalidates the key");
  } finally {
    service.dispose();
  }
});

test("a superseded request cannot apply its result", async () => {
  const model = modelOf();
  const service = new TopologyAnalysisService(model);
  try {
    // Two different configs so the second is not a cache hit. The first is superseded
    // before it can settle; only the second may reach the view.
    service.request(config({ metric: "weight" }));
    service.request(config({ metric: "confidence" }));

    const state = await until(service, (candidate) => candidate.status === "ready");
    assert.ok(state.result);
    assert.equal(state.result.metric, "confidence", "the stale request's result was discarded");
  } finally {
    service.dispose();
  }
});

test("cooperative cancellation leaves the service idle and usable", async () => {
  const service = new TopologyAnalysisService(modelOf());
  try {
    service.request(config());
    service.cancel();
    assert.equal(service.getState().status, "idle");

    // Still usable afterwards: cancelling is not a terminal state.
    const ready = until(service, (state) => state.status === "ready");
    service.request(config({ metric: "decayed-weight" }));
    assert.ok((await ready).result);
  } finally {
    service.dispose();
  }
});

test("a hard worker restart leaves the service usable", async () => {
  const service = new TopologyAnalysisService(modelOf());
  try {
    service.request(config());
    service.restartWorker();
    assert.equal(service.getState().status, "idle");

    const ready = until(service, (state) => state.status === "ready");
    service.request(config({ metric: "confidence" }));
    assert.ok((await ready).result);
  } finally {
    service.dispose();
  }
});

test("exceeding the simplex ceiling fails with phase and input-size provenance", async () => {
  const service = new TopologyAnalysisService(modelOf());
  try {
    const failed = until(service, (state) => state.status === "failed");
    service.request(config({ limits: { maxSimplices: 2, maxColumnEntries: 10 } }));
    const state = await failed;

    assert.ok(state.failure);
    assert.equal(state.failure.reason, "limit-exceeded");
    assert.equal(state.failure.phase, "building");
    assert.ok(state.failure.simplexCount > 2, "the failure says what was attempted");
    assert.equal(state.failure.vertexCount, 4);
    // An honest partial-result message names the ceiling and how to move it.
    assert.match(state.failure.message, /ceiling/u);
  } finally {
    service.dispose();
  }
});

test("bootstrap runs only when it is asked for", async () => {
  const service = new TopologyAnalysisService(modelOf());
  try {
    const withoutReady = until(service, (state) => state.status === "ready");
    service.request(config());
    assert.equal((await withoutReady).result?.uncertainty, undefined, "off by default");

    const withReady = until(service, (state) => state.status === "ready" && state.result?.uncertainty !== undefined);
    service.request(
      config({ bootstrap: { ...DEFAULT_BOOTSTRAP_CONFIG, enabled: true, sampleCount: 5, budgetMs: 3000 } }),
    );
    const uncertainty = (await withReady).result?.uncertainty;

    assert.ok(uncertainty);
    assert.equal(uncertainty.mode, "subsample");
    assert.equal(uncertainty.requestedSamples, 5);
    assert.ok(uncertainty.completedSamples > 0);
    assert.match(uncertainty.samplingScheme, /Stratified subsampling/u);
    assert.ok(
      !/confidence/iu.test(uncertainty.samplingScheme),
      "bootstrap support must never be described as a confidence band",
    );
  } finally {
    service.dispose();
  }
});
