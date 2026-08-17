import re

def fix_file(filepath, callback):
    with open(filepath, 'r') as f:
        content = f.read()
    new_content = callback(content)
    with open(filepath, 'w') as f:
        f.write(new_content)
    print(f"Fixed {filepath}")

# 1. listener.ts
def fix_listener(c):
    return re.sub(r'<<<<<<< HEAD\n.*?onLedgerCommitted\?:.*?Promise<void>;\n=======\n(.*?onLedgerCommitted\?:.*?void \| Promise<void>;)\n>>>>>>> main', r'\1', c, flags=re.DOTALL)
fix_file('backend/src/indexer/listener.ts', fix_listener)

# 2. README.md
def fix_readme(c):
    return re.sub(r'<<<<<<< HEAD\n(.*?)\n=======\n(.*?)\n>>>>>>> main', r'\1\n\2', c, flags=re.DOTALL)
fix_file('README.md', fix_readme)

# 3. index.ts
def fix_index(c):
    # Block 1
    c = re.sub(r'<<<<<<< HEAD\nimport pool from \'\./db/timescale\';\nimport \{ PostgresReputationRepository \} from \'\./reputation/repository\';\nimport \{ createRedisClientFromEnv, ReputationCache \} from \'\./cache/reputationCache\';\n=======\nimport client from \'prom-client\';\nimport \{ startSnapshotCron \} from \'\./indexer/cron\';\nimport \{ closeCache, initCache, isCacheAvailable \} from \'\./indexer/cache\';\nimport \{ standardLimiter, strictLimiter \} from \'\./middleware/rateLimiter\';\n>>>>>>> main',
    '''import pool from './db/timescale';
import { PostgresReputationRepository } from './reputation/repository';
import { createRedisClientFromEnv, ReputationCache } from './cache/reputationCache';
import client from 'prom-client';
import { startSnapshotCron } from './indexer/cron';
import { standardLimiter, strictLimiter } from './middleware/rateLimiter';''', c)
    
    # Block 2
    c = re.sub(r'<<<<<<< HEAD\nconst redis = createRedisClientFromEnv\(\);\nredis\.on\(\'error\', \(error\) => console\.error\(\'Redis connection error\', error\)\);\nconst reputationCache = new ReputationCache\(\n  redis,\n  new PostgresReputationRepository\(pool\),\n  \{ ttlSeconds: Number\(process\.env\.REPUTATION_CACHE_TTL_SECONDS \?\? 300\) \},\n\);\napp\.use\(\'/reputation\', createReputationRouter\(reputationCache\)\);\n=======\napp\.use\(\'/reputation\', reputationRouter\);\n// Also mounted here because that is where the placeholder handler used to live\.\napp\.use\(\'/api/reputation\', reputationRouter\);\n>>>>>>> main',
    '''const redis = createRedisClientFromEnv();
redis.on('error', (error) => console.error('Redis connection error', error));
const reputationCache = new ReputationCache(
  redis,
  new PostgresReputationRepository(pool),
  { ttlSeconds: Number(process.env.REPUTATION_CACHE_TTL_SECONDS ?? 300) },
);
const reputationRouterInstance = createReputationRouter(reputationCache);
app.use('/reputation', reputationRouterInstance);
// Also mounted here because that is where the placeholder handler used to live.
app.use('/api/reputation', reputationRouterInstance);''', c)
    
    # Block 3
    c = re.sub(r'<<<<<<< HEAD\n=======\nif \(process\.env\.INDEXER_ENABLED !== \'off\'\) \{.*?\n>>>>>>> main',
    '''if (process.env.INDEXER_ENABLED !== 'off') {
  startSnapshotCron();
}

let server: ReturnType<typeof app.listen>;

async function init() {
  server = app.listen(port, () => {
    console.log(`[api] Server running on port ${port}`);
    console.log(`[metrics] Prometheus metrics on port ${metricsPort}`);
  });
}

init();

export const stop = async () => {
  server?.close();
};''', c, flags=re.DOTALL)
    
    # Fix the health endpoint using isCacheAvailable which no longer exists
    c = re.sub(r'cache: isCacheAvailable\(\),', r'', c)
    return c
fix_file('backend/src/index.ts', fix_index)

