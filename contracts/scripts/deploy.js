// SPDX-License-Identifier: MIT
/**
 * @file   deploy.js
 * @title  RedHawkEscrow — Deployment Script (Hardhat)
 * @notice Deploys RedHawkEscrow (and optionally mock tokens) to any network.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *  Local hardhat node:
 *    npx hardhat run scripts/deploy.js --network localhost
 *
 *  Arc Testnet (requires .env with DEPLOYER_PRIVATE_KEY & ARC_RPC_URL):
 *    npx hardhat run scripts/deploy.js --network arcTestnet
 *
 * ── Required env vars ────────────────────────────────────────────────────────
 *  DEPLOYER_PRIVATE_KEY   — Private key of the deployer wallet (0x-prefixed)
 *  FEE_RECIPIENT          — Address that collects platform fees (optional;
 *                           defaults to deployer)
 *  USDC_ADDRESS           — Existing USDC address (optional; deploys mock if unset)
 *  EURC_ADDRESS           — Existing EURC address (optional; deploys mock if unset)
 *  DEPLOY_MOCKS           — Set to "true" to always deploy mock tokens regardless
 *
 * ── Arc Testnet known addresses ─────────────────────────────────────────────
 *  USDC: 0x3600000000000000000000000000000000000000  (Arc native-wrapped USDC)
 *  EURC: 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
 */

require("dotenv").config({ path: "../.env" });

const { ethers, network } = require("hardhat");

// ─── Arc Network constants ───────────────────────────────────────────────────
const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ARC_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Pretty-print the separator line */
const sep = () => console.log("─".repeat(72));

/** Sleep n milliseconds (used for block confirmations) */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  sep();
  console.log("  redhawk-store — RedHawkEscrow Deployment");
  sep();

  // 1. Signers
  const [deployer] = await ethers.getSigners();
  console.log(`  Network      : ${network.name} (chainId ${network.config.chainId ?? "unknown"})`);
  console.log(`  Deployer     : ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance      : ${ethers.formatEther(balance)} ETH/native`);
  sep();

  // 2. Determine token addresses
  const isLocalNetwork =
    network.name === "hardhat" ||
    network.name === "localhost" ||
    process.env.DEPLOY_MOCKS === "true";

  let usdcAddress = process.env.USDC_ADDRESS;
  let eurcAddress = process.env.EURC_ADDRESS;

  // For Arc Testnet use known addresses unless overridden
  if (network.config.chainId === ARC_TESTNET_CHAIN_ID) {
    usdcAddress = usdcAddress || ARC_USDC;
    eurcAddress = eurcAddress || ARC_EURC;
    console.log("  Using Arc Testnet token addresses (USDC + EURC).");
  }

  // Deploy mock tokens when running locally (or DEPLOY_MOCKS=true)
  if (isLocalNetwork || !usdcAddress || !eurcAddress) {
    console.log("\n  Deploying MockERC20 tokens for local/test environment...");

    const MockERC20 = await ethers.getContractFactory("MockERC20");

    if (!usdcAddress) {
      const mockUsdc = await MockERC20.deploy("USD Coin (mock)", "USDC", 6);
      await mockUsdc.waitForDeployment();
      usdcAddress = await mockUsdc.getAddress();
      console.log(`  MockUSDC     → ${usdcAddress}`);

      // Mint 1 million USDC to deployer for testing
      await mockUsdc.mint(deployer.address, ethers.parseUnits("1000000", 6));
      console.log("               (minted 1,000,000 USDC to deployer)");
    }

    if (!eurcAddress) {
      const mockEurc = await MockERC20.deploy("Euro Coin (mock)", "EURC", 6);
      await mockEurc.waitForDeployment();
      eurcAddress = await mockEurc.getAddress();
      console.log(`  MockEURC     → ${eurcAddress}`);

      await mockEurc.mint(deployer.address, ethers.parseUnits("1000000", 6));
      console.log("               (minted 1,000,000 EURC to deployer)");
    }
  }

  console.log(`\n  USDC address : ${usdcAddress}`);
  console.log(`  EURC address : ${eurcAddress}`);
  sep();

  // 3. Fee recipient — defaults to deployer
  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;
  console.log(`  Fee recipient: ${feeRecipient}`);
  sep();

  // 4. Deploy RedHawkEscrow
  console.log("\n  Deploying RedHawkEscrow...");

  const RedHawkEscrow = await ethers.getContractFactory("RedHawkEscrow");
  const escrow = await RedHawkEscrow.deploy(usdcAddress, eurcAddress, feeRecipient);

  // Wait for deployment (more confirmations on live networks)
  const confirmations = isLocalNetwork ? 1 : 3;
  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  console.log(`  RedHawkEscrow → ${escrowAddress}`);

  // 5. Verify configuration on-chain
  console.log("\n  Verifying deployment...");
  const onChainFeeBps     = await escrow.feeBps();
  const onChainFeeRcp     = await escrow.feeRecipient();
  const usdcAllowed       = await escrow.allowedTokens(usdcAddress);
  const eurcAllowed       = await escrow.allowedTokens(eurcAddress);
  const onChainOwner      = await escrow.owner();

  console.log(`  owner()      = ${onChainOwner}`);
  console.log(`  feeBps()     = ${onChainFeeBps} bps (${Number(onChainFeeBps) / 100}%)`);
  console.log(`  feeRecipient = ${onChainFeeRcp}`);
  console.log(`  USDC allowed = ${usdcAllowed}`);
  console.log(`  EURC allowed = ${eurcAllowed}`);

  if (!usdcAllowed || !eurcAllowed || onChainOwner !== deployer.address) {
    console.error("\n  ❌  Deployment verification FAILED — check contract state.");
    process.exit(1);
  }
  sep();

  // 6. Print deployment summary
  const deploymentInfo = {
    network: network.name,
    chainId: network.config.chainId,
    deployer: deployer.address,
    contracts: {
      RedHawkEscrow: escrowAddress,
      USDC: usdcAddress,
      EURC: eurcAddress,
    },
    config: {
      feeRecipient,
      feeBps: Number(onChainFeeBps),
      deliveryTimeoutDays: 7,
    },
    deployedAt: new Date().toISOString(),
  };

  console.log("\n  ✅  Deployment successful!\n");
  console.log("  ┌─ Deployment Summary ───────────────────────────────────────┐");
  console.log(`  │  Network       : ${network.name.padEnd(42)} │`);
  console.log(`  │  Escrow        : ${escrowAddress.padEnd(42)} │`);
  console.log(`  │  USDC          : ${usdcAddress.padEnd(42)} │`);
  console.log(`  │  EURC          : ${eurcAddress.padEnd(42)} │`);
  console.log(`  │  Fee           : ${String(Number(onChainFeeBps) / 100 + "%").padEnd(42)} │`);
  console.log(`  │  Fee recipient : ${feeRecipient.padEnd(42)} │`);
  console.log("  └────────────────────────────────────────────────────────────┘");

  // 7. Print environment variable snippet for frontend
  console.log("\n  Copy these values into your .env / Cloudflare secrets:\n");
  console.log(`  ESCROW_CONTRACT_ADDRESS=${escrowAddress}`);
  console.log(`  USDC_ADDRESS=${usdcAddress}`);
  console.log(`  EURC_ADDRESS=${eurcAddress}`);

  // 8. Optionally save deployment artifact
  const fs = require("fs");
  const artifactPath = `./deployments/${network.name}.json`;
  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n  📄  Deployment artifact saved to ${artifactPath}`);
  sep();
}

// ─── entry point ─────────────────────────────────────────────────────────────

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n  ❌  Deployment failed:", err.message || err);
    process.exit(1);
  });
