/**
 * Low-level transaction building, simulation, assembly, signing, and
 * submission helpers shared across all PactumClient methods.
 */
import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

export interface TxOptions {
  rpcServer: rpc.Server;
  contract: Contract;
  networkPassphrase: string;
}

/**
 * Builds a transaction envelope that calls a single contract function, then
 * simulates it.  Returns the simulation result and the unsigned transaction
 * for further processing.
 */
async function buildAndSimulate(
  opts: TxOptions,
  signerPublicKey: string,
  method: string,
  args: xdr.ScVal[],
): Promise<{
  simulation: rpc.Api.SimulateTransactionResponse;
  tx: ReturnType<TransactionBuilder['build']>;
}> {
  const account = await opts.rpcServer.getAccount(signerPublicKey);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: opts.networkPassphrase,
  })
    .addOperation(opts.contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulation = await opts.rpcServer.simulateTransaction(tx);
  return { simulation, tx };
}

/**
 * Executes a state-mutating contract call (requires a keypair to sign).
 * Returns the transaction hash on success.
 */
export async function invokeContract(
  opts: TxOptions,
  secret: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const keypair = Keypair.fromSecret(secret);
  const { simulation, tx } = await buildAndSimulate(
    opts,
    keypair.publicKey(),
    method,
    args,
  );

  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(
      `Soroban simulation error in '${method}': ${simulation.error}`,
    );
  }

  const prepared = rpc.assembleTransaction(tx, simulation).build();
  prepared.sign(keypair);

  const sendResult = await opts.rpcServer.sendTransaction(prepared);
  if (sendResult.errorResult) {
    throw new Error(
      `Transaction send error in '${method}': ${JSON.stringify(sendResult.errorResult)}`,
    );
  }

  const finalResult = await opts.rpcServer.pollTransaction(sendResult.hash);
  if (finalResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `Transaction failed in '${method}': status=${finalResult.status}`,
    );
  }

  return sendResult.hash;
}

/**
 * Executes a read-only contract call via simulation only (no signing required).
 * Returns the raw ScVal result.
 */
export async function queryContract(
  opts: TxOptions,
  publicKey: string,
  method: string,
  args: xdr.ScVal[],
): Promise<xdr.ScVal> {
  // For read-only calls we use a stub account (sequence 0) so no network
  // round-trip is needed to fetch the real sequence number.
  const stubAccount = new Account(publicKey, '0');
  const tx = new TransactionBuilder(stubAccount, {
    fee: BASE_FEE,
    networkPassphrase: opts.networkPassphrase,
  })
    .addOperation(opts.contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulation = await opts.rpcServer.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(
      `Soroban simulation error in '${method}': ${simulation.error}`,
    );
  }

  const successSim = simulation as rpc.Api.SimulateTransactionSuccessResponse;
  if (!successSim.result) {
    throw new Error(`No result returned from simulation of '${method}'.`);
  }

  return successSim.result.retval;
}
