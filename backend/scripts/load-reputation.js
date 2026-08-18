/* eslint-disable */
const autocannon = require('autocannon');

const address = process.env.LOAD_TEST_ADDRESS || `G${'A'.repeat(55)}`;
const target = process.env.LOAD_TEST_URL || `http://127.0.0.1:3000/reputation/${address}`;

async function main() {
  await fetch(target); // warm the cache before measuring the hot path
  const result = await autocannon({
    url: target,
    duration: Number(process.env.LOAD_TEST_DURATION_SECONDS || 30),
    connections: Number(process.env.LOAD_TEST_CONNECTIONS || 500),
    pipelining: Number(process.env.LOAD_TEST_PIPELINING || 10),
  });
  console.log(autocannon.printResult(result));
  if (result.latency.p99 >= 15 || result.requests.average < 10000) {
    throw new Error(`SLO failed: ${result.requests.average} req/s, P99 ${result.latency.p99}ms`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
