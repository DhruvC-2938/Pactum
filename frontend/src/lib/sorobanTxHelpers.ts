import { Contract, rpc, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { signTransaction } from '@stellar/freighter-api';
import type { WalletProvider } from './wallet';
import { signTransactionWithLedger } from './wallet-adapters/ledger-adapter';

const BASE_FEE = '100000';
const DEFAULT_SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org:443';
const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const DEFAULT_CONTRACT_ID = 'CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E';

export async function submitGenericSorobanTx({
  methodName,
  args,
  signerAddress,
  walletProvider = 'freighter',
  onStatusUpdate,
  rpcUrl = import.meta.env.VITE_SOROBAN_RPC_URL || DEFAULT_SOROBAN_RPC_URL,
  contractId = import.meta.env.VITE_PACTUM_CONTRACT_ID || DEFAULT_CONTRACT_ID,
  networkPassphrase = import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || DEFAULT_NETWORK_PASSPHRASE,
}: {
  methodName: string;
  args: xdr.ScVal[];
  signerAddress: string;
  walletProvider?: WalletProvider;
  onStatusUpdate?: (msg: string) => void;
  rpcUrl?: string;
  contractId?: string;
  networkPassphrase?: string;
}) {
  onStatusUpdate?.('Initializing Soroban RPC connection...');
  const server = new rpc.Server(rpcUrl, { allowHttp: true });

  onStatusUpdate?.('Fetching sequence number for account...');
  let account: any = null;
  try {
    account = await server.getAccount(signerAddress);
  } catch (err: any) {
    throw new Error(
      `Connected account (${signerAddress.substring(0, 8)}...) is not funded on Stellar Testnet.`,
    );
  }

  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(methodName, ...args))
    .setTimeout(60)
    .build();

  onStatusUpdate?.('Simulating transaction on Soroban RPC...');
  const preparedTx = await server.prepareTransaction(tx);
  const unsignedXdr = preparedTx.toXDR();

  let signedXdr = '';
  if (walletProvider === 'ledger') {
    onStatusUpdate?.('Awaiting signature on Ledger device...');
    signedXdr = await signTransactionWithLedger(unsignedXdr, networkPassphrase);
  } else {
    onStatusUpdate?.('Awaiting signature in Freighter wallet...');
    const signResult = await signTransaction(unsignedXdr, {
      networkPassphrase,
      address: signerAddress,
    });
    if (typeof signResult === 'string') signedXdr = signResult;
    else if (signResult && typeof signResult === 'object') {
      if ((signResult as any).error)
        throw new Error(`Freighter signing rejected: ${(signResult as any).error}`);
      signedXdr = (signResult as any).signedTxXdr || (signResult as any).signedXdr || '';
    }
  }

  if (!signedXdr) throw new Error('Transaction signing was cancelled.');

  onStatusUpdate?.('Submitting transaction to Stellar Testnet...');
  const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(signedTx);
  if (sendResult.status === 'ERROR' || sendResult.errorResult) {
    throw new Error(`RPC submission error: ${sendResult.errorResult || sendResult.status}`);
  }

  const txHash = sendResult.hash;
  onStatusUpdate?.(`Transaction submitted! Confirming hash ${txHash.substring(0, 10)}...`);

  let txStatus: rpc.Api.GetTransactionStatus = rpc.Api.GetTransactionStatus.NOT_FOUND;
  let txResult: rpc.Api.GetTransactionResponse | null = null;
  let attempts = 0;
  while (attempts < 25) {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    txResult = await server.getTransaction(txHash);
    txStatus = txResult.status;
    if (txStatus === rpc.Api.GetTransactionStatus.SUCCESS) break;
    else if (txStatus === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction execution failed on Stellar Testnet. Hash: ${txHash}`);
    }
  }

  if (txStatus !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction confirmation timed out. Hash: ${txHash}`);
  }

  onStatusUpdate?.('Transaction confirmed successfully on-chain!');
  return { hash: txHash, status: 'SUCCESS' };
}

export async function submitAttest(
  id: number,
  outcome: string,
  signer: string,
  provider: WalletProvider,
  onStatusUpdate?: (msg: string) => void,
) {
  const args = [
    xdr.ScVal.scvU64(xdr.Uint64.fromString(id.toString())),
    xdr.ScVal.scvSymbol(outcome),
  ];
  return submitGenericSorobanTx({
    methodName: 'attest',
    args,
    signerAddress: signer,
    walletProvider: provider,
    onStatusUpdate,
  });
}

export async function submitDispute(
  id: number,
  reason: string,
  signer: string,
  provider: WalletProvider,
  onStatusUpdate?: (msg: string) => void,
) {
  const args = [
    xdr.ScVal.scvU64(xdr.Uint64.fromString(id.toString())),
    xdr.ScVal.scvString(reason),
  ];
  return submitGenericSorobanTx({
    methodName: 'dispute',
    args,
    signerAddress: signer,
    walletProvider: provider,
    onStatusUpdate,
  });
}

export async function submitResolve(
  id: number,
  outcome: string,
  signer: string,
  provider: WalletProvider,
  onStatusUpdate?: (msg: string) => void,
) {
  const args = [
    xdr.ScVal.scvU64(xdr.Uint64.fromString(id.toString())),
    xdr.ScVal.scvSymbol(outcome),
  ];
  return submitGenericSorobanTx({
    methodName: 'resolve_dispute',
    args,
    signerAddress: signer,
    walletProvider: provider,
    onStatusUpdate,
  });
}

export async function submitInitRegistry(
  signer: string,
  provider: WalletProvider,
  onStatusUpdate?: (msg: string) => void,
) {
  return submitGenericSorobanTx({
    methodName: 'init',
    args: [],
    signerAddress: signer,
    walletProvider: provider,
    onStatusUpdate,
  });
}
