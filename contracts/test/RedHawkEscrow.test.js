const { expect }          = require("chai");
const { ethers }           = require("hardhat");
const { time }             = require("@nomicfoundation/hardhat-network-helpers");

// ─── helpers ────────────────────────────────────────────────────────────────

const USDC_DECIMALS = 6;
const EURC_DECIMALS = 6;

const e6  = (n) => ethers.parseUnits(String(n), 6);   // 6-decimal tokens
const BPS = 10_000n;
const FEE = 150n;   // 1.5 %

/** Deterministic orderId from buyer + seller + nonce */
function orderId(buyer, seller, nonce = 1) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [buyer, seller, nonce]
    )
  );
}

// ─── fixture ────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [owner, feeRecipient, buyer, seller, stranger] = await ethers.getSigners();

  // Deploy mock tokens
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", USDC_DECIMALS);
  const eurc = await MockERC20.deploy("Euro Coin", "EURC", EURC_DECIMALS);
  const rogue = await MockERC20.deploy("Rogue Token", "RGT", 18);

  // Deploy escrow
  const Escrow = await ethers.getContractFactory("RedHawkEscrow");
  const escrow = await Escrow.deploy(
    await usdc.getAddress(),
    await eurc.getAddress(),
    feeRecipient.address
  );

  // Mint USDC/EURC to buyer
  const BUYER_BALANCE = e6(10_000);
  await usdc.mint(buyer.address, BUYER_BALANCE);
  await eurc.mint(buyer.address, BUYER_BALANCE);
  await rogue.mint(buyer.address, BUYER_BALANCE);

  // Helper: full happy-path up to funded
  async function createAndFund(token, amount, nonce = 1) {
    const oid = orderId(buyer.address, seller.address, nonce);
    await escrow.connect(buyer).createEscrow(
      oid, seller.address, await token.getAddress(), amount
    );
    await token.connect(buyer).approve(await escrow.getAddress(), amount);
    await escrow.connect(buyer).fundEscrow(oid);
    return oid;
  }

  return { escrow, usdc, eurc, rogue, owner, feeRecipient, buyer, seller, stranger, createAndFund };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("RedHawkEscrow", function () {

  // ── 1. Deployment ──────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets correct owner", async function () {
      const { escrow, owner } = await deployFixture();
      expect(await escrow.owner()).to.equal(owner.address);
    });

    it("sets default fee to 1.5%", async function () {
      const { escrow } = await deployFixture();
      expect(await escrow.feeBps()).to.equal(150n);
    });

    it("whitelists USDC and EURC", async function () {
      const { escrow, usdc, eurc } = await deployFixture();
      expect(await escrow.allowedTokens(await usdc.getAddress())).to.be.true;
      expect(await escrow.allowedTokens(await eurc.getAddress())).to.be.true;
    });

    it("rejects zero-address constructor args", async function () {
      const { usdc, eurc, feeRecipient } = await deployFixture();
      const Escrow = await ethers.getContractFactory("RedHawkEscrow");
      await expect(
        Escrow.deploy(ethers.ZeroAddress, await eurc.getAddress(), feeRecipient.address)
      ).to.be.revertedWithCustomError(Escrow, "ZeroAddress");
    });
  });

  // ── 2. createEscrow ────────────────────────────────────────────────────────

  describe("createEscrow()", function () {
    it("creates a valid USDC escrow", async function () {
      const { escrow, usdc, buyer, seller } = await deployFixture();
      const oid = orderId(buyer.address, seller.address);
      const amount = e6(100);

      await escrow.connect(buyer).createEscrow(
        oid, seller.address, await usdc.getAddress(), amount
      );

      const e = await escrow.getEscrow(oid);
      expect(e.buyer).to.equal(buyer.address);
      expect(e.seller).to.equal(seller.address);
      expect(e.token).to.equal(await usdc.getAddress());
      expect(e.amount).to.equal(amount);
      expect(e.isFunded).to.be.false;
    });

    it("emits EscrowCreated", async function () {
      const { escrow, usdc, buyer, seller } = await deployFixture();
      const oid = orderId(buyer.address, seller.address);
      await expect(
        escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), e6(50))
      ).to.emit(escrow, "EscrowCreated").withArgs(
        oid, buyer.address, seller.address, await usdc.getAddress(), e6(50)
      );
    });

    it("rejects non-whitelisted token", async function () {
      const { escrow, rogue, buyer, seller } = await deployFixture();
      const oid = orderId(buyer.address, seller.address);
      await expect(
        escrow.connect(buyer).createEscrow(oid, seller.address, await rogue.getAddress(), e6(10))
      ).to.be.revertedWithCustomError(escrow, "TokenNotAllowed");
    });

    it("rejects zero amount", async function () {
      const { escrow, usdc, buyer, seller } = await deployFixture();
      const oid = orderId(buyer.address, seller.address);
      await expect(
        escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), 0)
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
    });

    it("rejects duplicate orderId", async function () {
      const { escrow, usdc, buyer, seller } = await deployFixture();
      const oid = orderId(buyer.address, seller.address);
      await escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), e6(10));
      await expect(
        escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), e6(10))
      ).to.be.revertedWithCustomError(escrow, "EscrowAlreadyExists");
    });

    it("rejects buyer == seller", async function () {
      const { escrow, usdc, buyer } = await deployFixture();
      const oid = orderId(buyer.address, buyer.address);
      await expect(
        escrow.connect(buyer).createEscrow(oid, buyer.address, await usdc.getAddress(), e6(10))
      ).to.be.revertedWithCustomError(escrow, "BuyerCannotBeSeller");
    });

    it("calculates fee correctly in struct", async function () {
      const { escrow, usdc, buyer, seller } = await deployFixture();
      const oid = orderId(buyer.address, seller.address);
      const amount = e6(1000);
      await escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), amount);
      const e = await escrow.getEscrow(oid);
      const expectedFee = (amount * FEE) / BPS;
      expect(e.fee).to.equal(expectedFee);
    });
  });

  // ── 3. fundEscrow ──────────────────────────────────────────────────────────

  describe("fundEscrow()", function () {
    it("transfers tokens from buyer to contract", async function () {
      const { escrow, usdc, buyer, seller } = await deployFixture();
      const oid   = orderId(buyer.address, seller.address);
      const amount = e6(200);

      await escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), amount);
      await usdc.connect(buyer).approve(await escrow.getAddress(), amount);

      const buyerBefore   = await usdc.balanceOf(buyer.address);
      const contractBefore = await usdc.balanceOf(await escrow.getAddress());

      await escrow.connect(buyer).fundEscrow(oid);

      expect(await usdc.balanceOf(buyer.address)).to.equal(buyerBefore - amount);
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(contractBefore + amount);
    });

    it("sets isFunded = true", async function () {
      const { escrow, usdc, buyer, seller } = await deployFixture();
      const oid = orderId(buyer.address, seller.address);
      await escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), e6(10));
      await usdc.connect(buyer).approve(await escrow.getAddress(), e6(10));
      await escrow.connect(buyer).fundEscrow(oid);
      const e = await escrow.getEscrow(oid);
      expect(e.isFunded).to.be.true;
    });

    it("emits Funded event", async function () {
      const { escrow, usdc, buyer, seller } = await deployFixture();
      const oid    = orderId(buyer.address, seller.address);
      const amount = e6(100);
      const fee    = (amount * FEE) / BPS;
      await escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), amount);
      await usdc.connect(buyer).approve(await escrow.getAddress(), amount);
      await expect(escrow.connect(buyer).fundEscrow(oid))
        .to.emit(escrow, "Funded").withArgs(oid, amount, fee);
    });

    it("reverts if not buyer", async function () {
      const { escrow, usdc, buyer, seller, stranger } = await deployFixture();
      const oid = orderId(buyer.address, seller.address);
      await escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), e6(10));
      await usdc.connect(buyer).approve(await escrow.getAddress(), e6(10));
      await expect(escrow.connect(stranger).fundEscrow(oid))
        .to.be.revertedWithCustomError(escrow, "NotBuyer");
    });

    it("reverts on double fund", async function () {
      const { escrow, usdc, buyer, seller } = await deployFixture();
      const oid = orderId(buyer.address, seller.address);
      await escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), e6(10));
      await usdc.connect(buyer).approve(await escrow.getAddress(), e6(20));
      await escrow.connect(buyer).fundEscrow(oid);
      await expect(escrow.connect(buyer).fundEscrow(oid))
        .to.be.revertedWithCustomError(escrow, "AlreadyFunded");
    });
  });

  // ── 4. markShipped ────────────────────────────────────────────────────────

  describe("markShipped()", function () {
    it("sets isShipped = true and records shippedAt", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      const e = await escrow.getEscrow(oid);
      expect(e.isShipped).to.be.true;
      expect(e.shippedAt).to.be.gt(0n);
    });

    it("emits Shipped event", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await expect(escrow.connect(seller).markShipped(oid))
        .to.emit(escrow, "Shipped");
    });

    it("reverts if not seller", async function () {
      const { escrow, usdc, buyer, createAndFund, stranger } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await expect(escrow.connect(stranger).markShipped(oid))
        .to.be.revertedWithCustomError(escrow, "NotSeller");
    });

    it("reverts if not funded", async function () {
      const { escrow, usdc, buyer, seller } = await deployFixture();
      const oid = orderId(buyer.address, seller.address);
      await escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), e6(10));
      await expect(escrow.connect(seller).markShipped(oid))
        .to.be.revertedWithCustomError(escrow, "NotFunded");
    });

    it("reverts on double shipment", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      await expect(escrow.connect(seller).markShipped(oid))
        .to.be.revertedWithCustomError(escrow, "AlreadyShipped");
    });
  });

  // ── 5. confirmDelivery ────────────────────────────────────────────────────

  describe("confirmDelivery()", function () {
    it("sets isDelivered = true", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      await escrow.connect(buyer).confirmDelivery(oid);
      const e = await escrow.getEscrow(oid);
      expect(e.isDelivered).to.be.true;
    });

    it("emits Delivered", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      await expect(escrow.connect(buyer).confirmDelivery(oid))
        .to.emit(escrow, "Delivered").withArgs(oid);
    });

    it("reverts if not buyer", async function () {
      const { escrow, usdc, buyer, seller, createAndFund, stranger } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      await expect(escrow.connect(stranger).confirmDelivery(oid))
        .to.be.revertedWithCustomError(escrow, "NotBuyer");
    });

    it("reverts if not shipped", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await expect(escrow.connect(buyer).confirmDelivery(oid))
        .to.be.revertedWithCustomError(escrow, "NotShipped");
    });
  });

  // ── 6. releaseFunds ───────────────────────────────────────────────────────

  describe("releaseFunds()", function () {
    it("sends net amount to seller and retains fee", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const amount  = e6(1000);
      const fee     = (amount * FEE) / BPS;
      const net     = amount - fee;
      const oid     = await createAndFund(usdc, amount);

      await escrow.connect(seller).markShipped(oid);
      await escrow.connect(buyer).confirmDelivery(oid);

      const sellerBefore = await usdc.balanceOf(seller.address);
      await escrow.connect(seller).releaseFunds(oid);

      expect(await usdc.balanceOf(seller.address)).to.equal(sellerBefore + net);
      expect(await escrow.accruedFees(await usdc.getAddress())).to.equal(fee);
    });

    it("emits Released with correct net amount", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const amount = e6(500);
      const net    = amount - (amount * FEE) / BPS;
      const oid    = await createAndFund(usdc, amount);
      await escrow.connect(seller).markShipped(oid);
      await escrow.connect(buyer).confirmDelivery(oid);
      await expect(escrow.connect(seller).releaseFunds(oid))
        .to.emit(escrow, "Released").withArgs(oid, seller.address, net);
    });

    it("reverts if not seller", async function () {
      const { escrow, usdc, buyer, seller, createAndFund, stranger } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      await escrow.connect(buyer).confirmDelivery(oid);
      await expect(escrow.connect(stranger).releaseFunds(oid))
        .to.be.revertedWithCustomError(escrow, "NotSeller");
    });

    it("reverts if not delivered", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      await expect(escrow.connect(seller).releaseFunds(oid))
        .to.be.revertedWithCustomError(escrow, "NotDelivered");
    });

    it("reverts on double release", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      await escrow.connect(buyer).confirmDelivery(oid);
      await escrow.connect(seller).releaseFunds(oid);
      await expect(escrow.connect(seller).releaseFunds(oid))
        .to.be.revertedWithCustomError(escrow, "AlreadyReleased");
    });

    it("sets isReleased = true", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      await escrow.connect(buyer).confirmDelivery(oid);
      await escrow.connect(seller).releaseFunds(oid);
      const e = await escrow.getEscrow(oid);
      expect(e.isReleased).to.be.true;
    });
  });

  // ── 7. Full happy-path (USDC) ─────────────────────────────────────────────

  describe("Happy path — USDC", function () {
    it("full lifecycle: create -> fund -> ship -> deliver -> release", async function () {
      const { escrow, usdc, buyer, seller, feeRecipient, createAndFund } = await deployFixture();
      const amount = e6(999);
      const fee    = (amount * FEE) / BPS;
      const net    = amount - fee;
      const oid    = await createAndFund(usdc, amount);

      await escrow.connect(seller).markShipped(oid);
      await escrow.connect(buyer).confirmDelivery(oid);
      await escrow.connect(seller).releaseFunds(oid);

      expect(await usdc.balanceOf(seller.address)).to.equal(net);
      expect(await escrow.accruedFees(await usdc.getAddress())).to.equal(fee);
    });
  });

  // ── 8. Full happy-path (EURC) ─────────────────────────────────────────────

  describe("Happy path — EURC", function () {
    it("full lifecycle with EURC token", async function () {
      const { escrow, eurc, buyer, seller, createAndFund } = await deployFixture();
      const amount = e6(250);
      const net    = amount - (amount * FEE) / BPS;
      const oid    = await createAndFund(eurc, amount);

      await escrow.connect(seller).markShipped(oid);
      await escrow.connect(buyer).confirmDelivery(oid);
      await escrow.connect(seller).releaseFunds(oid);

      expect(await eurc.balanceOf(seller.address)).to.equal(net);
    });
  });

  // ── 9. Dispute flow ───────────────────────────────────────────────────────

  describe("Dispute flow", function () {
    it("buyer can open dispute after funding", async function () {
      const { escrow, usdc, buyer, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await expect(escrow.connect(buyer).openDispute(oid))
        .to.emit(escrow, "Disputed").withArgs(oid, buyer.address);
      const e = await escrow.getEscrow(oid);
      expect(e.isDisputed).to.be.true;
    });

    it("seller can open dispute after shipping", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      await expect(escrow.connect(seller).openDispute(oid))
        .to.emit(escrow, "Disputed").withArgs(oid, seller.address);
    });

    it("stranger cannot open dispute", async function () {
      const { escrow, usdc, buyer, createAndFund, stranger } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await expect(escrow.connect(stranger).openDispute(oid))
        .to.be.revertedWithCustomError(escrow, "NotParty");
    });

    it("admin resolves dispute in seller favour — seller gets net", async function () {
      const { escrow, usdc, buyer, seller, owner, createAndFund } = await deployFixture();
      const amount = e6(300);
      const fee    = (amount * FEE) / BPS;
      const net    = amount - fee;
      const oid    = await createAndFund(usdc, amount);
      await escrow.connect(buyer).openDispute(oid);

      const sellerBefore = await usdc.balanceOf(seller.address);
      await expect(escrow.connect(owner).resolveDispute(oid, true))
        .to.emit(escrow, "Resolved").withArgs(oid, true, seller.address, net);

      expect(await usdc.balanceOf(seller.address)).to.equal(sellerBefore + net);
      expect(await escrow.accruedFees(await usdc.getAddress())).to.equal(fee);
    });

    it("admin resolves dispute in buyer favour — buyer gets full refund", async function () {
      const { escrow, usdc, buyer, seller, owner, createAndFund } = await deployFixture();
      const amount = e6(300);
      const oid    = await createAndFund(usdc, amount);
      await escrow.connect(buyer).openDispute(oid);

      const buyerBefore = await usdc.balanceOf(buyer.address);
      await expect(escrow.connect(owner).resolveDispute(oid, false))
        .to.emit(escrow, "Resolved").withArgs(oid, false, buyer.address, amount);

      expect(await usdc.balanceOf(buyer.address)).to.equal(buyerBefore + amount);
      // No fee accrued when buyer wins
      expect(await escrow.accruedFees(await usdc.getAddress())).to.equal(0n);
    });

    it("non-admin cannot resolve dispute", async function () {
      const { escrow, usdc, buyer, seller, createAndFund, stranger } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(buyer).openDispute(oid);
      await expect(escrow.connect(stranger).resolveDispute(oid, true))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("disputed escrow blocks ship/deliver/release", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(buyer).openDispute(oid);

      await expect(escrow.connect(seller).markShipped(oid))
        .to.be.revertedWithCustomError(escrow, "EscrowDisputed");
    });

    it("reverts resolveDispute if not disputed", async function () {
      const { escrow, usdc, buyer, createAndFund, owner } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await expect(escrow.connect(owner).resolveDispute(oid, true))
        .to.be.revertedWithCustomError(escrow, "EscrowNotDisputed");
    });
  });

  // ── 10. Timeout system ────────────────────────────────────────────────────

  describe("Timeout system", function () {
    it("seller cannot claim before timeout", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      await expect(escrow.connect(seller).claimTimeout(oid))
        .to.be.revertedWithCustomError(escrow, "TimeoutNotReached");
    });

    it("seller can claim after 7 days of no delivery confirmation", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const amount = e6(400);
      const net    = amount - (amount * FEE) / BPS;
      const oid    = await createAndFund(usdc, amount);
      await escrow.connect(seller).markShipped(oid);

      // Advance 7 days + 1 second
      await time.increase(7 * 24 * 3600 + 1);

      const sellerBefore = await usdc.balanceOf(seller.address);
      await expect(escrow.connect(seller).claimTimeout(oid))
        .to.emit(escrow, "TimeoutClaimed").withArgs(oid, seller.address, net);

      expect(await usdc.balanceOf(seller.address)).to.equal(sellerBefore + net);
    });

    it("isTimedOut() returns true after timeout", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      expect(await escrow.isTimedOut(oid)).to.be.false;
      await time.increase(7 * 24 * 3600 + 1);
      expect(await escrow.isTimedOut(oid)).to.be.true;
    });

    it("timeoutRemaining() decreases with time", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      const remaining = await escrow.timeoutRemaining(oid);
      expect(remaining).to.be.gt(0n);
      await time.increase(3600);
      const remaining2 = await escrow.timeoutRemaining(oid);
      expect(remaining2).to.be.lt(remaining);
    });

    it("dispute prevents timeout claim", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(seller).markShipped(oid);
      await escrow.connect(buyer).openDispute(oid);
      await time.increase(7 * 24 * 3600 + 1);
      await expect(escrow.connect(seller).claimTimeout(oid))
        .to.be.revertedWithCustomError(escrow, "EscrowDisputed");
    });
  });

  // ── 11. Fee management ────────────────────────────────────────────────────

  describe("Fee management", function () {
    it("owner can update fee within cap", async function () {
      const { escrow, owner } = await deployFixture();
      await expect(escrow.connect(owner).setFee(200))
        .to.emit(escrow, "FeeUpdated").withArgs(150n, 200n);
      expect(await escrow.feeBps()).to.equal(200n);
    });

    it("reverts if fee exceeds 5%", async function () {
      const { escrow, owner } = await deployFixture();
      await expect(escrow.connect(owner).setFee(501))
        .to.be.revertedWithCustomError(escrow, "FeeTooHigh");
    });

    it("non-owner cannot update fee", async function () {
      const { escrow, stranger } = await deployFixture();
      await expect(escrow.connect(stranger).setFee(100))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("owner can withdraw accrued fees", async function () {
      const { escrow, usdc, buyer, seller, owner, feeRecipient, createAndFund } = await deployFixture();
      const amount = e6(1000);
      const fee    = (amount * FEE) / BPS;
      const oid    = await createAndFund(usdc, amount);
      await escrow.connect(seller).markShipped(oid);
      await escrow.connect(buyer).confirmDelivery(oid);
      await escrow.connect(seller).releaseFunds(oid);

      const recipientBefore = await usdc.balanceOf(feeRecipient.address);
      await expect(escrow.connect(owner).withdrawFees(await usdc.getAddress()))
        .to.emit(escrow, "FeesWithdrawn");

      expect(await usdc.balanceOf(feeRecipient.address)).to.equal(recipientBefore + fee);
      expect(await escrow.accruedFees(await usdc.getAddress())).to.equal(0n);
    });

    it("reverts withdrawFees if nothing accrued", async function () {
      const { escrow, usdc, owner } = await deployFixture();
      await expect(escrow.connect(owner).withdrawFees(await usdc.getAddress()))
        .to.be.revertedWithCustomError(escrow, "NoFeesToWithdraw");
    });
  });

  // ── 12. Token whitelist admin ─────────────────────────────────────────────

  describe("Token whitelist", function () {
    it("owner can add a new token", async function () {
      const { escrow, rogue, owner } = await deployFixture();
      await expect(escrow.connect(owner).setTokenAllowance(await rogue.getAddress(), true))
        .to.emit(escrow, "TokenAllowanceUpdated").withArgs(await rogue.getAddress(), true);
      expect(await escrow.allowedTokens(await rogue.getAddress())).to.be.true;
    });

    it("owner can remove a token", async function () {
      const { escrow, usdc, owner } = await deployFixture();
      await escrow.connect(owner).setTokenAllowance(await usdc.getAddress(), false);
      expect(await escrow.allowedTokens(await usdc.getAddress())).to.be.false;
    });

    it("non-owner cannot modify whitelist", async function () {
      const { escrow, rogue, stranger } = await deployFixture();
      await expect(escrow.connect(stranger).setTokenAllowance(await rogue.getAddress(), true))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  // ── 13. View helpers ──────────────────────────────────────────────────────

  describe("View helpers", function () {
    it("netSellerAmount returns amount minus fee", async function () {
      const { escrow, usdc, buyer, seller } = await deployFixture();
      const oid    = orderId(buyer.address, seller.address);
      const amount = e6(1000);
      const net    = amount - (amount * FEE) / BPS;
      await escrow.connect(buyer).createEscrow(oid, seller.address, await usdc.getAddress(), amount);
      expect(await escrow.netSellerAmount(oid)).to.equal(net);
    });

    it("netSellerAmount reverts for non-existent orderId", async function () {
      const { escrow } = await deployFixture();
      await expect(escrow.netSellerAmount(ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });
  });

  // ── 14. ETH rejection ─────────────────────────────────────────────────────

  describe("ETH rejection", function () {
    it("reverts on direct ETH send", async function () {
      const { escrow, buyer } = await deployFixture();
      await expect(
        buyer.sendTransaction({ to: await escrow.getAddress(), value: ethers.parseEther("1") })
      ).to.be.reverted;
    });
  });

  // ── 15. Ownable2Step ──────────────────────────────────────────────────────

  describe("Ownable2Step", function () {
    it("ownership transfer requires acceptance", async function () {
      const { escrow, owner, stranger } = await deployFixture();
      await escrow.connect(owner).transferOwnership(stranger.address);
      // Not yet transferred
      expect(await escrow.owner()).to.equal(owner.address);
      // Stranger accepts
      await escrow.connect(stranger).acceptOwnership();
      expect(await escrow.owner()).to.equal(stranger.address);
    });
  });

  // ── 16. Edge cases ────────────────────────────────────────────────────────

  describe("Edge cases", function () {
    it("escrow not found for unknown orderId", async function () {
      const { escrow } = await deployFixture();
      await expect(escrow.markShipped(ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });

    it("multiple independent escrows do not interfere", async function () {
      const { escrow, usdc, buyer, seller, createAndFund } = await deployFixture();
      const oid1 = await createAndFund(usdc, e6(100), 1);
      const oid2 = await createAndFund(usdc, e6(200), 2);

      // Complete escrow 1
      await escrow.connect(seller).markShipped(oid1);
      await escrow.connect(buyer).confirmDelivery(oid1);
      await escrow.connect(seller).releaseFunds(oid1);

      // Escrow 2 still independent
      const e2 = await escrow.getEscrow(oid2);
      expect(e2.isReleased).to.be.false;
      expect(e2.isFunded).to.be.true;
    });

    it("setFeeRecipient updates correctly", async function () {
      const { escrow, owner, stranger } = await deployFixture();
      await expect(escrow.connect(owner).setFeeRecipient(stranger.address))
        .to.emit(escrow, "FeeRecipientUpdated");
      expect(await escrow.feeRecipient()).to.equal(stranger.address);
    });

    it("cannot open dispute twice", async function () {
      const { escrow, usdc, buyer, createAndFund } = await deployFixture();
      const oid = await createAndFund(usdc, e6(100));
      await escrow.connect(buyer).openDispute(oid);
      await expect(escrow.connect(buyer).openDispute(oid))
        .to.be.revertedWithCustomError(escrow, "EscrowDisputed");
    });
  });
});
