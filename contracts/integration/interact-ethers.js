/**
 * @file    interact-ethers.js
 * @title   RedHawkEscrow — ethers.js v6 interaction examples
 * @notice  Full buyer + seller + admin flow using ethers.js v6.
 *
 * ── Requirements ────────────────────────────────────────────────────────────
 *   npm install ethers dotenv
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   BUYER_PK=0x...  SELLER_PK=0x...  ADMIN_PK=0x...  \
 *   ESCROW_ADDRESS=0x...  USDC_ADDRESS=0x...           \
 *   node interact-ethers.js
 *
 * ── Arc Testnet constants ───────────────────────────────────────────────────
 *   RPC  : https://rpc.testnet.arc.network
 *   Chain: 5042002
 */

require("dotenv").config({ path: "../.env" });
const { ethers } = require("ethers");

// ─── Config ──────────────────────────────────────────────────────────────────

const ARC_RPC        = "https://rpc.testnet.arc.network";
const CHAIN_ID       = 5042002;
const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS || "0x867650F5eAe8df91445971f14d89fd84F0C9a9f8";
const USDC_ADDRESS   = process.env.USDC_ADDRESS   || "0x3600000000000000000000000000000000000000";
const EURC_ADDRESS   = process.env.EURC_ADDRESS   || "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ESCROW_ABI = [
  // Write functions
  "function createEscrow(bytes32 orderId, address seller, address token, uint256 amount) external",
  "function fundEscrow(bytes32 orderId) external",
  "function markShipped(bytes32 orderId) external",
  "function confirmDelivery(bytes32 orderId) external",
  "function releaseFunds(bytes32 orderId) external",
  "function openDispute(bytes32 orderId) external",
  "function resolveDispute(bytes32 orderId, bool releaseToSeller) external",
  "function claimTimeout(bytes32 orderId) external",
  "function setFee(uint256 newFeeBps) external",
  "function setFeeRecipient(address newRecipient) external",
  "function setTokenAllowance(address token, bool allowed) external",
  "function withdrawFees(address token) external",
  // Read functions
  "function getEscrow(bytes32 orderId) external view returns (tuple(address buyer, address seller, address token, uint256 amount, uint256 fee, uint256 shippedAt, bool isFunded, bool isShipped, bool isDelivered, bool isReleased, bool isDisputed, bool isRefunded))",
  "function isTimedOut(bytes32 orderId) external view returns (bool)",
  "function timeoutRemaining(bytes32 orderId) external view returns (uint256)",
  "function netSellerAmount(bytes32 orderId) external view returns (uint256)",
  "function feeBps() external view returns (uint256)",
  "function feeRecipient() external view returns (address)",
  "function allowedTokens(address) external view returns (bool)",
  "function accruedFees(address) external view returns (uint256)",
  "function owner() external view returns (address)",
  // Events
  "event EscrowCreated(bytes32 indexed orderId, address indexed buyer, address indexed seller, address token, uint256 amount)",
  "event Funded(bytes32 indexed orderId, uint256 amount, uint256 fee)",
  "event Shipped(bytes32 indexed orderId, uint256 shippedAt)",
  "event Delivered(bytes32 indexed orderId)",
  "event Released(bytes32 indexed orderId, address indexed seller, uint256 netAmount)",
  "event Disputed(bytes32 indexed orderId, address indexed raisedBy)",
  "event Resolved(bytes32 indexed orderId, bool releasedToSeller, address recipient, uint256 amount)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format 6-decimal token amount */
const fmt6 = (n) => ethers.formatUnits(n, 6);

/** Parse 6-decimal token amount */
const parse6 = (n) => ethers.parseUnits(String(n), 6);

/** Generate a deterministic orderId from buyer, seller and nonce */
function makeOrderId(buyerAddress, sellerAddress, nonce = Date.now()) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [buyerAddress, sellerAddress, nonce]
    )
  );
}

/** Wait for tx and log hash + block */
async function sendAndWait(txPromise, label) {
  const tx = await txPromise;
  console.log(`  ✔ ${label}`);
  console.log(`    tx: ${tx.hash}`);
  const receipt = await tx.wait(1);
  console.log(`    block: ${receipt.blockNumber}  gas used: ${receipt.gasUsed.toString()}`);
  return receipt;
}

// ─── Main demo flow ──────────────────────────────────────────────────────────

async function main() {
  // ------------------------------------------------------------------
  // 1. Provider + Signers
  // ------------------------------------------------------------------
  const provider = new ethers.JsonRpcProvider(ARC_RPC, {
    chainId: CHAIN_ID,
    name: "Arc Testnet",
  });

  // In production wallets are injected by MetaMask:
  //   const provider  = new ethers.BrowserProvider(window.ethereum);
  //   const buyerSigner = await provider.getSigner();

  // For scripts we use private keys from env
  const buyerSigner  = new ethers.Wallet(process.env.BUYER_PK  || ethers.Wallet.createRandom().privateKey, provider);
  const sellerSigner = new ethers.Wallet(process.env.SELLER_PK || ethers.Wallet.createRandom().privateKey, provider);
  const adminSigner  = new ethers.Wallet(process.env.ADMIN_PK  || ethers.Wallet.createRandom().privateKey, provider);

  console.log("─".repeat(72));
  console.log("  redhawk-store / RedHawkEscrow — ethers.js v6 examples");
  console.log("─".repeat(72));
  console.log(`  Buyer  : ${buyerSigner.address}`);
  console.log(`  Seller : ${sellerSigner.address}`);
  console.log(`  Admin  : ${adminSigner.address}`);
  console.log("─".repeat(72));

  // ------------------------------------------------------------------
  // 2. Contract instances
  // ------------------------------------------------------------------
  const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, buyerSigner);
  const usdc   = new ethers.Contract(USDC_ADDRESS,   ERC20_ABI, buyerSigner);

  // ------------------------------------------------------------------
  // 3. Read contract state
  // ------------------------------------------------------------------
  console.log("\n── Contract State ──────────────────────────────────────────────");
  const feeBps       = await escrow.feeBps();
  const feeRecipient = await escrow.feeRecipient();
  const usdcAllowed  = await escrow.allowedTokens(USDC_ADDRESS);
  const eurcAllowed  = await escrow.allowedTokens(EURC_ADDRESS);

  console.log(`  feeBps       : ${feeBps} (${Number(feeBps) / 100}%)`);
  console.log(`  feeRecipient : ${feeRecipient}`);
  console.log(`  USDC allowed : ${usdcAllowed}`);
  console.log(`  EURC allowed : ${eurcAllowed}`);

  // ------------------------------------------------------------------
  // 4. Generate orderId
  // ------------------------------------------------------------------
  const nonce   = Date.now();
  const orderId = makeOrderId(buyerSigner.address, sellerSigner.address, nonce);
  const amount  = parse6("100"); // 100 USDC

  console.log("\n── Step 1: createEscrow() ──────────────────────────────────────");
  console.log(`  orderId : ${orderId}`);
  console.log(`  amount  : ${fmt6(amount)} USDC`);

  await sendAndWait(
    escrow.createEscrow(orderId, sellerSigner.address, USDC_ADDRESS, amount),
    "Escrow created"
  );

  // ------------------------------------------------------------------
  // 5. Fund escrow  (buyer approves + funds)
  // ------------------------------------------------------------------
  console.log("\n── Step 2: fundEscrow() ────────────────────────────────────────");

  // Check current allowance and approve if needed
  const currentAllowance = await usdc.allowance(buyerSigner.address, ESCROW_ADDRESS);
  if (currentAllowance < amount) {
    await sendAndWait(
      usdc.approve(ESCROW_ADDRESS, amount),
      "USDC approve"
    );
  } else {
    console.log("  ✔ Sufficient allowance already set");
  }

  await sendAndWait(escrow.fundEscrow(orderId), "Escrow funded");

  // Confirm escrow state
  let state = await escrow.getEscrow(orderId);
  console.log(`  isFunded : ${state.isFunded}`);

  // ------------------------------------------------------------------
  // 6. Mark shipped  (seller)
  // ------------------------------------------------------------------
  console.log("\n── Step 3: markShipped() ───────────────────────────────────────");
  const escrowAsSeller = escrow.connect(sellerSigner);
  await sendAndWait(escrowAsSeller.markShipped(orderId), "Marked shipped");

  state = await escrow.getEscrow(orderId);
  const shippedDate = new Date(Number(state.shippedAt) * 1000).toISOString();
  console.log(`  isShipped  : ${state.isShipped}  (at ${shippedDate})`);

  // Check timeout remaining
  const remaining = await escrow.timeoutRemaining(orderId);
  console.log(`  timeoutRemaining: ${Number(remaining) / 86400} days`);

  // ------------------------------------------------------------------
  // 7. Confirm delivery  (buyer)
  // ------------------------------------------------------------------
  console.log("\n── Step 4: confirmDelivery() ───────────────────────────────────");
  await sendAndWait(escrow.confirmDelivery(orderId), "Delivery confirmed");

  // ------------------------------------------------------------------
  // 8. Release funds  (seller)
  // ------------------------------------------------------------------
  console.log("\n── Step 5: releaseFunds() ──────────────────────────────────────");
  const netAmount = await escrow.netSellerAmount(orderId);
  console.log(`  netSellerAmount : ${fmt6(netAmount)} USDC`);

  await sendAndWait(escrowAsSeller.releaseFunds(orderId), "Funds released");

  state = await escrow.getEscrow(orderId);
  console.log(`  isReleased : ${state.isReleased}`);

  // ------------------------------------------------------------------
  // 9. Withdraw fees  (admin)
  // ------------------------------------------------------------------
  console.log("\n── Admin: withdrawFees() ───────────────────────────────────────");
  const accrued = await escrow.accruedFees(USDC_ADDRESS);
  console.log(`  Accrued fees : ${fmt6(accrued)} USDC`);

  if (accrued > 0n) {
    const escrowAsAdmin = escrow.connect(adminSigner);
    await sendAndWait(escrowAsAdmin.withdrawFees(USDC_ADDRESS), "Fees withdrawn");
  } else {
    console.log("  ℹ️  No fees accrued yet (account may not be admin).");
  }

  // ------------------------------------------------------------------
  // 10. Dispute example  (separate orderId)
  // ------------------------------------------------------------------
  console.log("\n── Dispute Example ─────────────────────────────────────────────");
  const disputeNonce   = nonce + 1;
  const disputeOrderId = makeOrderId(buyerSigner.address, sellerSigner.address, disputeNonce);
  const disputeAmount  = parse6("50");

  // Create + fund
  await sendAndWait(
    escrow.createEscrow(disputeOrderId, sellerSigner.address, USDC_ADDRESS, disputeAmount),
    "Dispute escrow created"
  );
  const allowance2 = await usdc.allowance(buyerSigner.address, ESCROW_ADDRESS);
  if (allowance2 < disputeAmount) {
    await sendAndWait(usdc.approve(ESCROW_ADDRESS, disputeAmount), "USDC approve");
  }
  await sendAndWait(escrow.fundEscrow(disputeOrderId), "Dispute escrow funded");

  // Buyer opens dispute
  await sendAndWait(escrow.openDispute(disputeOrderId), "Dispute opened");

  // Admin resolves in buyer's favour (full refund)
  const escrowAsAdmin = escrow.connect(adminSigner);
  await sendAndWait(
    escrowAsAdmin.resolveDispute(disputeOrderId, false),
    "Dispute resolved → refund buyer"
  );

  console.log("\n  ✅  All interactions completed successfully.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("\n  ❌  Error:", err.message || err);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
//  BROWSER / METAMASK INTEGRATION SNIPPET
//  (paste this in your frontend's wallet.js)
// ─────────────────────────────────────────────────────────────────────────────
/*

const ARC = window.ARC; // injected by globalScript in index.tsx

async function escrowCheckout({ orderId, sellerAddress, tokenAddress, amount }) {
  // 1. UX safety: never auto-trigger. User clicks "Confirm Purchase" first.
  // 2. Show confirmation modal BEFORE requesting wallet signature
  const confirmed = await showTxConfirmModal({
    action: "Lock funds in escrow",
    value: ethers.formatUnits(amount, 6),
    token: tokenAddress === ARC.contracts.USDC ? "USDC" : "EURC",
    network: ARC.networkName,
    contractAddress: ARC.contracts.FxEscrow,
    details: "Funds will be locked until you confirm delivery or 7 days after shipment."
  });

  if (!confirmed) return; // user cancelled — NEVER proceed silently

  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer   = await provider.getSigner();

  // Verify correct network
  const { chainId } = await provider.getNetwork();
  if (Number(chainId) !== ARC.chainId) {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + ARC.chainId.toString(16) }],
    });
  }

  const escrow = new ethers.Contract(ARC.contracts.FxEscrow, ESCROW_ABI, signer);
  const token  = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

  // Step 1: approve (show what will be approved)
  const approveTx = await token.approve(ARC.contracts.FxEscrow, amount);
  await approveTx.wait();

  // Step 2: createEscrow
  const createTx = await escrow.createEscrow(orderId, sellerAddress, tokenAddress, amount);
  await createTx.wait();

  // Step 3: fundEscrow
  const fundTx = await escrow.fundEscrow(orderId);
  const receipt = await fundTx.wait();

  return receipt;
}

*/
