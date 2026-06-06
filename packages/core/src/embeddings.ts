/**
 * Semantic retrieval via embeddings (upgrade over lexical retrieval.ts).
 *
 * Pluggable EmbeddingProvider; built on the Vercel AI SDK. Falls back to
 * lexical retrieval when no embedding backend is configured, so the tutor
 * always works. An index is built once per repo and reused across queries.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type EmbeddingModel, cosineSimilarity, embedMany } from "ai";
import { type RetrievedNode, nodeText } from "./retrieval.js";
import type { KnowledgeGraph, KnowledgeNode } from "./types.js";

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingConfig {
  provider: string; // openai | openai-compatible
  model: string;
  apiKey?: string;
  baseURL?: string;
}

function buildEmbeddingModel(cfg: EmbeddingConfig): EmbeddingModel {
  const key = cfg.apiKey ? { apiKey: cfg.apiKey } : {};
  switch (cfg.provider) {
    case "openai":
      return createOpenAI(key).textEmbeddingModel(cfg.model);
    case "openai-compatible": {
      if (!cfg.baseURL) throw new Error("embedding 'openai-compatible' requires MA_EMBED_BASE_URL");
      return createOpenAICompatible({ name: "ma-embed", baseURL: cfg.baseURL, ...key }).textEmbeddingModel(
        cfg.model,
      );
    }
    default:
      throw new Error(`unknown MA_EMBED_PROVIDER: ${cfg.provider}`);
  }
}

export class VercelEmbeddingProvider implements EmbeddingProvider {
  private readonly model: EmbeddingModel;
  constructor(cfg: EmbeddingConfig) {
    this.model = buildEmbeddingModel(cfg);
  }
  async embed(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({ model: this.model, values: texts });
    return embeddings;
  }
}

export function embeddingProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { provider?: EmbeddingProvider; describe: string } {
  let provider = env.MA_EMBED_PROVIDER;
  let model = env.MA_EMBED_MODEL;
  const baseURL = env.MA_EMBED_BASE_URL;
  let auto = false;

  // Zero-config: with an OpenAI key present, default to OpenAI embeddings.
  if (!provider && !baseURL && env.OPENAI_API_KEY) {
    provider = "openai";
    model = model ?? "text-embedding-3-small";
    auto = true;
  }
  if (!provider && baseURL) provider = "openai-compatible";
  if (!provider || !model) return { describe: "off — lexical retrieval" };

  return {
    provider: new VercelEmbeddingProvider({
      provider,
      model,
      apiKey: env.MA_EMBED_API_KEY ?? env.OPENAI_API_KEY ?? env.MA_LLM_API_KEY,
      baseURL,
    }),
    describe: `${provider}${auto ? ", auto-detected" : ""} · ${model}`,
  };
}

/** A built vector index over a repo's symbol nodes. */
export class EmbeddingIndex {
  private constructor(
    private readonly graph: KnowledgeGraph,
    private readonly provider: EmbeddingProvider,
    private readonly nodeIds: string[],
    private readonly vectors: number[][],
  ) {}

  static async build(graph: KnowledgeGraph, provider: EmbeddingProvider): Promise<EmbeddingIndex> {
    const nodes = graph.nodes.filter((n) => n.kind !== "file");
    const vectors = nodes.length ? await provider.embed(nodes.map(nodeText)) : [];
    return new EmbeddingIndex(
      graph,
      provider,
      nodes.map((n) => n.id),
      vectors,
    );
  }

  async query(query: string, k = 8): Promise<RetrievedNode[]> {
    if (this.vectors.length === 0) return [];
    const [q] = await this.provider.embed([query]);
    if (!q) return [];
    const byId = new Map(this.graph.nodes.map((n) => [n.id, n]));
    const scored = this.nodeIds
      .map((id, i) => ({ node: byId.get(id) as KnowledgeNode, score: cosineSimilarity(q, this.vectors[i]!) }))
      .filter((s) => s.node);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
}
