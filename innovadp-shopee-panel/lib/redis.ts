import { createClient } from "@vercel/kv";
import type { VercelKV } from "@vercel/kv";

// Tenta encontrar as variáveis de ambiente, dando preferência ao padrão Vercel KV,
// mas aceitando o padrão Upstash (Marketplace) como fallback.
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_TOKEN;

// Exporta um cliente seguro que não quebra o build se as variáveis faltarem.
// O erro só será lançado quando tentarmos USAR o cliente, não ao importar o arquivo.
export const kv: VercelKV = (url && token)
    ? createClient({ url, token })
    : (new Proxy({} as any, {
        get: () => {
            throw new Error(
                "Variáveis de ambiente do Redis não encontradas. " +
                "Configure KV_REST_API_URL/TOKEN (Vercel KV) ou UPSTASH_REDIS_REST_URL/TOKEN (Upstash)."
            );
        },
    }) as VercelKV);
