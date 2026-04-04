/**
 * @file    interact-viem.ts
 * @title   RedHawkEscrow — viem interaction examples
 * @notice  Full buyer + seller + admin flow using viem v2.
 *
 * ── Requirements ────────────────────────────────────────────────────────────
 *   npm install viem
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   BUYER_PK=0x...  SELLER_PK=0x...  ADMIN_PK=0x...  \
 *   ESCROW_ADDRESS=0x...  USDC_ADDRESS=0x...           \
 *   npx tsx interact-viem.ts
 *
 * ── Arc Testnet ─────────────────────────────────────────────────────────────
 *   RPC  : https://rpc.testnet.arc.network
 *   Chain: 5042002
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

// ─── Arc Testnet chain definition ─────────────────────────────────────────────

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    public:  { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

// ─── Contract addresses ───────────────────────────────────────────────────────

const ESCROW_ADDRESS: Address = (process.env.ESCROW_ADDRESS ?? "0x867650F5eAe8df91445971f14d89fd84F0C9a9f8") as Address;
const USDC_ADDRESS:   Address = (process.env.USDC_ADDRESS   ?? "0x3600000000000000000000000000000000000000") as Address;
const EURC_ADDRESS:   Address = (process.env.EURC_ADDRESS   ?? "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a") as Address;

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const escrowAbi = [
  // Write
  { type: "function", name: "createEscrow",    inputs: [{ name: "orderId", type: "bytes32" }, { name: "seller", type: "address" }, { name: "token", type: "address" }, { name: "amount", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "fundEscrow",      inputs: [{ name: "orderId", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "markShipped",     inputs: [{ name: "orderId", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "confirmDelivery", inputs: [{ name: "orderId", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "releaseFunds",    inputs: [{ name: "orderId", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "openDispute",     inputs: [{ name: "orderId", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "resolveDispute",  inputs: [{ name: "orderId", type: "bytes32" }, { name: "releaseToSeller", type: "bool" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "claimTimeout",    inputs: [{ name: "orderId", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "withdrawFees",    inputs: [{ name: "token", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  // Read
  {
    type: "function", name: "getEscrow",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "buyer",       type: "address" },
        { name: "seller",      type: "address" },
        { name: "token",       type: "address" },
        { name: "amount",      type: "uint256" },
        { name: "fee",         type: "uint256" },
        { name: "shippedAt",   type: "uint256" },
        { name: "isFunded",    type: "bool" },
        { name: "isShipped",   type: "bool" },
        { name: "isDelivered", type: "bool" },
        { name: "isReleased",  type: "bool" },
        { name: "isDisputed",  type: "bool" },
        { name: "isRefunded",  type: "bool" },
      ],
    }],
    stateMutability: "view",
  },
  { type: "function", name: "feeBps",            inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "feeRecipient",       inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "allowedTokens",      inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "accruedFees",        inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "netSellerAmount",    inputs: [{ name: "orderId", type: "bytes32" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "isTimedOut",         inputs: [{ name: "orderId", type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "timeoutRemaining",   inputs: [{ name: "orderId", type: "bytes32" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "owner",              inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  // Events
  { type: "event", name: "EscrowCreated", inputs: [{ name: "orderId", type: "bytes32", indexed: true }, { name: "buyer", type: "address", indexed: true }, { name: "seller", type: "address", indexed: true }, { name: "token", type: "address" }, { name: "amount", type: "uint256" }] },
  { type: "event", name: "Funded",        inputs: [{ name: "orderId", type: "bytes32", indexed: true }, { name: "amount", type: "uint256" }, { name: "fee", type: "uint256" }] },
  { type: "event", name: "Released",      inputs: [{ name: "orderId", type: "bytes32", indexed: true }, { name: "seller", type: "address", indexed: true }, { name: "netAmount", type: "uint256" }] },
  { type: "event", name: "Disputed",      inputs: [{ name: "orderId", type: "bytes32", indexed: true }, { name: "raisedBy", type: "address", indexed: true }] },
  { type: "event", name: "Resolved",      inputs: [{ name: "orderId", type: "bytes32", indexed: true }, { name: "releasedToSeller", type: "bool" }, { name: "recipient", type: "address" }, { name: "amount", type: "uint256" }] },
] as const;

const erc20Abi = [
  { type: "function", name: "approve",   inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "balanceOf", inputs: [{ name: "owner", type: "address" }],  outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt6  = (n: bigint) => formatUnits(n, 6);
const parse6 = (n: string | number) => parseUnits(String(n), 6);

/** Generate deterministic orderId (same algorithm as the contract tests) */
function makeOrderId(buyer: Address, seller: Address, nonce: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, address, uint256"),
      [buyer, seller, nonce]
    )
  );
}

const sep = () => console.log("─".repeat(72));
const log = (msg: string) => console.log(`  ${msg}`);

/** Write tx helper: simulates first (catches reverts early), then sends */
async function write(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  config: Parameters<typeof walletClient.writeContract>[0],
  label: string
) {
  // Simulate first to surface revert messages before spending gas
  await publicClient.simulateContract(config as any).catch((err: Error) => {
    throw new Error(`Simulation failed for "${label}": ${err.message}`);
  });

  const hash = await walletClient.writeContract(config as any);
  log(`✔ ${label}`);
  log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log(`  block: ${receipt.blockNumber}  status: ${receipt.status}`);
  return receipt;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ------------------------------------------------------------------
  // 1. Clients
  // ------------------------------------------------------------------
  const transport = http("https://rpc.testnet.arc.network");

  const publicClient = createPublicClient({ chain: arcTestnet, transport });

  const buyerAccount  = privateKeyToAccount((process.env.BUYER_PK  ?? `0x${"a".repeat(64)}`) as Hex);
  const sellerAccount = privateKeyToAccount((process.env.SELLER_PK ?? `0x${"b".repeat(64)}`) as Hex);
  const adminAccount  = privateKeyToAccount((process.env.ADMIN_PK  ?? `0x${"c".repeat(64)}`) as Hex);

  const buyerWallet  = createWalletClient({ account: buyerAccount,  chain: arcTestnet, transport });
  const sellerWallet = createWalletClient({ account: sellerAccount, chain: arcTestnet, transport });
  const adminWallet  = createWalletClient({ account: adminAccount,  chain: arcTestnet, transport });

  sep();
  log("redhawk-store / RedHawkEscrow — viem v2 examples");
  sep();
  log(`Buyer  : ${buyerAccount.address}`);
  log(`Seller : ${sellerAccount.address}`);
  log(`Admin  : ${adminAccount.address}`);
  sep();

  // ------------------------------------------------------------------
  // 2. Read contract state
  // ------------------------------------------------------------------
  log("\n── Contract State ──────────────────────────────────────────────");
  const [feeBps, feeRecipient, usdcAllowed, eurcAllowed] = await Promise.all([
    publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "feeBps" }),
    publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "feeRecipient" }),
    publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "allowedTokens", args: [USDC_ADDRESS] }),
    publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "allowedTokens", args: [EURC_ADDRESS] }),
  ]);

  log(`feeBps       : ${feeBps} (${Number(feeBps) / 100}%)`);
  log(`feeRecipient : ${feeRecipient}`);
  log(`USDC allowed : ${usdcAllowed}`);
  log(`EURC allowed : ${eurcAllowed}`);

  // ------------------------------------------------------------------
  // 3. Create orderId
  // ------------------------------------------------------------------
  const nonce   = BigInt(Date.now());
  const orderId = makeOrderId(buyerAccount.address, sellerAccount.address, nonce);
  const amount  = parse6("100"); // 100 USDC

  log(`\n── Step 1: createEscrow() ──────────────────────────────────────`);
  log(`orderId : ${orderId}`);
  log(`amount  : ${fmt6(amount)} USDC`);

  await write(
    buyerWallet, publicClient,
    {
      address: ESCROW_ADDRESS, abi: escrowAbi,
      functionName: "createEscrow",
      args: [orderId, sellerAccount.address, USDC_ADDRESS, amount],
      account: buyerAccount, chain: arcTestnet,
    },
    "Escrow created"
  );

  // ------------------------------------------------------------------
  // 4. Approve + Fund
  // ------------------------------------------------------------------
  log(`\n── Step 2: approve() + fundEscrow() ────────────────────────────`);

  const currentAllowance = await publicClient.readContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: "allowance",
    args: [buyerAccount.address, ESCROW_ADDRESS],
  });

  if (currentAllowance < amount) {
    await write(
      buyerWallet, publicClient,
      { address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [ESCROW_ADDRESS, amount], account: buyerAccount, chain: arcTestnet },
      "USDC approve"
    );
  }

  await write(
    buyerWallet, publicClient,
    { address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "fundEscrow", args: [orderId], account: buyerAccount, chain: arcTestnet },
    "Escrow funded"
  );

  // ------------------------------------------------------------------
  // 5. markShipped  (seller)
  // ------------------------------------------------------------------
  log(`\n── Step 3: markShipped() ───────────────────────────────────────`);
  await write(
    sellerWallet, publicClient,
    { address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "markShipped", args: [orderId], account: sellerAccount, chain: arcTestnet },
    "Marked shipped"
  );

  const remaining = await publicClient.readContract({
    address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "timeoutRemaining", args: [orderId],
  });
  log(`timeoutRemaining: ${(Number(remaining) / 86400).toFixed(1)} days`);

  // ------------------------------------------------------------------
  // 6. confirmDelivery  (buyer)
  // ------------------------------------------------------------------
  log(`\n── Step 4: confirmDelivery() ───────────────────────────────────`);
  await write(
    buyerWallet, publicClient,
    { address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "confirmDelivery", args: [orderId], account: buyerAccount, chain: arcTestnet },
    "Delivery confirmed"
  );

  // ------------------------------------------------------------------
  // 7. releaseFunds  (seller)
  // ------------------------------------------------------------------
  log(`\n── Step 5: releaseFunds() ──────────────────────────────────────`);
  const netAmount = await publicClient.readContract({
    address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "netSellerAmount", args: [orderId],
  });
  log(`netSellerAmount : ${fmt6(netAmount)} USDC`);

  await write(
    sellerWallet, publicClient,
    { address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "releaseFunds", args: [orderId], account: sellerAccount, chain: arcTestnet },
    "Funds released"
  );

  // ------------------------------------------------------------------
  // 8. Admin: withdraw fees
  // ------------------------------------------------------------------
  log(`\n── Admin: withdrawFees() ───────────────────────────────────────`);
  const accrued = await publicClient.readContract({
    address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "accruedFees", args: [USDC_ADDRESS],
  });
  log(`Accrued fees : ${fmt6(accrued)} USDC`);

  if (accrued > 0n) {
    await write(
      adminWallet, publicClient,
      { address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "withdrawFees", args: [USDC_ADDRESS], account: adminAccount, chain: arcTestnet },
      "Fees withdrawn"
    );
  }

  // ------------------------------------------------------------------
  // 9. Event listener example
  // ------------------------------------------------------------------
  log(`\n── Listening for EscrowCreated events (5 s) ────────────────────`);
  const unwatch = publicClient.watchContractEvent({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    eventName: "EscrowCreated",
    onLogs: (logs) => {
      for (const { args } of logs) {
        log(`  🔔 New escrow: ${args.orderId} | buyer: ${args.buyer} | amount: ${fmt6(args.amount ?? 0n)} USDC`);
      }
    },
  });
  await new Promise((r) => setTimeout(r, 5000));
  unwatch();

  log("\n✅  All interactions completed.");
  sep();
}

main().catch((err) => {
  console.error("❌  Error:", err.message ?? err);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
//  WALLET-CONNECT / WAGMI SNIPPET  (React + wagmi v2)
// ─────────────────────────────────────────────────────────────────────────────
/*

import { useWriteContract, useReadContract, useWaitForTransactionReceipt } from "wagmi";

// Read escrow state
const { data: escrowState } = useReadContract({
  address: ESCROW_ADDRESS,
  abi: escrowAbi,
  functionName: "getEscrow",
  args: [orderId],
});

// Fund escrow (after user confirms modal)
const { writeContract, data: hash } = useWriteContract();
const { isLoading } = useWaitForTransactionReceipt({ hash });

const handleFund = () => {
  writeContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "fundEscrow",
    args: [orderId],
  });
};

*/
