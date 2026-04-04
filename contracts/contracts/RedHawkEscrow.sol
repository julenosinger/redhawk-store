// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  RedHawkEscrow
 * @author redhawk-store
 * @notice Production-ready escrow for the redhawk-store marketplace on Arc Network.
 *         Supports USDC (native-wrapped) and EURC (ERC-20) exclusively.
 *
 * ─── Lifecycle ────────────────────────────────────────────────────────────────
 *  1. Buyer calls createEscrow()  → escrow record created
 *  2. Buyer calls fundEscrow()    → tokens transferred to this contract
 *  3. Seller calls markShipped()  → shipment confirmed
 *  4. Buyer calls confirmDelivery() → delivery confirmed
 *  5. Seller calls releaseFunds() → seller receives tokens
 *
 *  Dispute path:
 *  - Either party calls openDispute() at any point after funding
 *  - Admin (owner / DAO) calls resolveDispute(orderId, releaseToSeller)
 *
 *  Timeout path:
 *  - If buyer has NOT confirmed delivery within DELIVERY_TIMEOUT seconds
 *    after markShipped(), seller can call claimTimeout() for auto-release.
 *
 * ─── Fee system ───────────────────────────────────────────────────────────────
 *  A platform fee (default 1.5%, max 5%) is deducted from the escrow amount
 *  when funds are released.  Fees accumulate in this contract and the owner
 *  can withdraw them via withdrawFees().
 *
 * ─── Security ─────────────────────────────────────────────────────────────────
 *  • ReentrancyGuard on all state-changing external calls
 *  • Ownable2Step for safe admin transfer
 *  • SafeERC20 for token transfers
 *  • Checks-Effects-Interactions pattern throughout
 *  • Token whitelist — only USDC and EURC accepted
 *  • No ETH handling (stablecoin-only on Arc Network)
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

contract RedHawkEscrow is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Maximum platform fee: 5% (500 basis points)
    uint256 public constant MAX_FEE_BPS = 500;

    /// @notice Default platform fee: 1.5% (150 basis points)
    uint256 public constant DEFAULT_FEE_BPS = 150;

    /// @notice Basis point denominator
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice 7 days — buyer must confirm delivery within this window after shipment
    uint256 public constant DELIVERY_TIMEOUT = 7 days;

    // ─────────────────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Platform fee in basis points (owner can update, capped at MAX_FEE_BPS)
    uint256 public feeBps;

    /// @notice Address that receives platform fees
    address public feeRecipient;

    /// @notice Approved payment tokens (USDC, EURC)
    mapping(address => bool) public allowedTokens;

    /// @notice Accumulated fees per token that have not been withdrawn yet
    mapping(address => uint256) public accruedFees;

    // ─────────────────────────────────────────────────────────────────────────
    //  Escrow struct
    // ─────────────────────────────────────────────────────────────────────────

    struct Escrow {
        address buyer;          // wallet that locks funds
        address seller;         // wallet that receives funds on release
        address token;          // USDC or EURC
        uint256 amount;         // gross amount deposited by buyer
        uint256 fee;            // platform fee calculated at fund time
        uint256 shippedAt;      // block.timestamp when seller marked shipped (0 if not shipped)
        bool    isFunded;       // true once buyer transferred tokens
        bool    isShipped;      // true once seller confirmed shipment
        bool    isDelivered;    // true once buyer confirmed receipt
        bool    isReleased;     // true once funds sent to seller
        bool    isDisputed;     // true if either party opened dispute
        bool    isRefunded;     // true if dispute resolved in buyer's favour
    }

    /// @notice Primary escrow storage — keyed by orderId (keccak256 of order data)
    mapping(bytes32 => Escrow) public escrows;

    // ─────────────────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────────────────

    event EscrowCreated(
        bytes32 indexed orderId,
        address indexed buyer,
        address indexed seller,
        address token,
        uint256 amount
    );
    event Funded(bytes32 indexed orderId, uint256 amount, uint256 fee);
    event Shipped(bytes32 indexed orderId, uint256 shippedAt);
    event Delivered(bytes32 indexed orderId);
    event Released(bytes32 indexed orderId, address indexed seller, uint256 netAmount);
    event Disputed(bytes32 indexed orderId, address indexed raisedBy);
    event Resolved(bytes32 indexed orderId, bool releasedToSeller, address recipient, uint256 amount);
    event TimeoutClaimed(bytes32 indexed orderId, address indexed seller, uint256 netAmount);
    event TokenAllowanceUpdated(address indexed token, bool allowed);
    event FeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event FeesWithdrawn(address indexed token, address indexed recipient, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────
    //  Errors
    // ─────────────────────────────────────────────────────────────────────────

    error TokenNotAllowed(address token);
    error EscrowAlreadyExists(bytes32 orderId);
    error EscrowNotFound(bytes32 orderId);
    error NotBuyer(bytes32 orderId);
    error NotSeller(bytes32 orderId);
    error NotParty(bytes32 orderId);
    error AlreadyFunded(bytes32 orderId);
    error NotFunded(bytes32 orderId);
    error NotShipped(bytes32 orderId);
    error AlreadyShipped(bytes32 orderId);
    error NotDelivered(bytes32 orderId);
    error AlreadyReleased(bytes32 orderId);
    error AlreadyRefunded(bytes32 orderId);
    error EscrowDisputed(bytes32 orderId);
    error EscrowNotDisputed(bytes32 orderId);
    error TimeoutNotReached(bytes32 orderId, uint256 remainingSeconds);
    error ZeroAmount();
    error ZeroAddress();
    error FeeTooHigh(uint256 requested, uint256 max);
    error NoFeesToWithdraw(address token);
    error BuyerCannotBeSeller();
    error AmountTooSmall(uint256 amount, uint256 minAmount);

    // ─────────────────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param _usdc         Arc Network USDC contract address
     * @param _eurc         Arc Network EURC contract address
     * @param _feeRecipient Address that will receive platform fees
     */
    constructor(
        address _usdc,
        address _eurc,
        address _feeRecipient
    ) Ownable2Step() Ownable(msg.sender) {
        if (_usdc == address(0) || _eurc == address(0) || _feeRecipient == address(0))
            revert ZeroAddress();

        allowedTokens[_usdc] = true;
        allowedTokens[_eurc] = true;

        feeRecipient  = _feeRecipient;
        feeBps        = DEFAULT_FEE_BPS;

        emit TokenAllowanceUpdated(_usdc, true);
        emit TokenAllowanceUpdated(_eurc, true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Core: Escrow lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Step 1 — Buyer creates an escrow record (no token transfer yet).
     * @param orderId   Unique identifier generated off-chain (keccak256 of order data)
     * @param seller    Seller's wallet address
     * @param token     Payment token (must be USDC or EURC)
     * @param amount    Gross amount buyer will deposit (before fee)
     *
     * @dev The orderId should be derived client-side as:
     *      keccak256(abi.encodePacked(buyerAddr, sellerAddr, timestamp, nonce))
     */
    function createEscrow(
        bytes32 orderId,
        address seller,
        address token,
        uint256 amount
    ) external {
        // ── Checks ──────────────────────────────────────────────────────────
        if (!allowedTokens[token])          revert TokenNotAllowed(token);
        if (seller == address(0))           revert ZeroAddress();
        if (amount == 0)                    revert ZeroAmount();
        if (seller == msg.sender)           revert BuyerCannotBeSeller();
        if (escrows[orderId].buyer != address(0)) revert EscrowAlreadyExists(orderId);

        // Minimum viable amount: fee must not consume everything
        uint256 feeAmount = (amount * feeBps) / BPS_DENOMINATOR;
        if (feeAmount >= amount)            revert AmountTooSmall(amount, BPS_DENOMINATOR / feeBps + 1);

        // ── Effects ─────────────────────────────────────────────────────────
        escrows[orderId] = Escrow({
            buyer:       msg.sender,
            seller:      seller,
            token:       token,
            amount:      amount,
            fee:         feeAmount,
            shippedAt:   0,
            isFunded:    false,
            isShipped:   false,
            isDelivered: false,
            isReleased:  false,
            isDisputed:  false,
            isRefunded:  false
        });

        emit EscrowCreated(orderId, msg.sender, seller, token, amount);
    }

    /**
     * @notice Step 2 — Buyer transfers tokens into this contract.
     * @dev    Buyer must have called token.approve(escrowAddress, amount) beforehand.
     *         Uses SafeERC20.safeTransferFrom — handles non-standard ERC-20s safely.
     */
    function fundEscrow(bytes32 orderId) external nonReentrant {
        Escrow storage e = _getEscrow(orderId);

        // ── Checks ──────────────────────────────────────────────────────────
        if (e.buyer != msg.sender)  revert NotBuyer(orderId);
        if (e.isFunded)             revert AlreadyFunded(orderId);
        if (e.isDisputed)           revert EscrowDisputed(orderId);

        // ── Effects ─────────────────────────────────────────────────────────
        e.isFunded = true;

        // ── Interactions ────────────────────────────────────────────────────
        IERC20(e.token).safeTransferFrom(msg.sender, address(this), e.amount);

        emit Funded(orderId, e.amount, e.fee);
    }

    /**
     * @notice Step 3 — Seller confirms shipment.
     *         Starts the DELIVERY_TIMEOUT clock.
     */
    function markShipped(bytes32 orderId) external {
        Escrow storage e = _getEscrow(orderId);

        // ── Checks ──────────────────────────────────────────────────────────
        if (e.seller != msg.sender) revert NotSeller(orderId);
        if (!e.isFunded)            revert NotFunded(orderId);
        if (e.isShipped)            revert AlreadyShipped(orderId);
        if (e.isDisputed)           revert EscrowDisputed(orderId);
        if (e.isReleased)           revert AlreadyReleased(orderId);

        // ── Effects ─────────────────────────────────────────────────────────
        e.isShipped  = true;
        e.shippedAt  = block.timestamp;

        emit Shipped(orderId, block.timestamp);
    }

    /**
     * @notice Step 4 — Buyer confirms delivery.
     *         Unlocks the ability for seller to call releaseFunds().
     */
    function confirmDelivery(bytes32 orderId) external {
        Escrow storage e = _getEscrow(orderId);

        // ── Checks ──────────────────────────────────────────────────────────
        if (e.buyer != msg.sender)  revert NotBuyer(orderId);
        if (!e.isShipped)           revert NotShipped(orderId);
        if (e.isDelivered)          revert AlreadyReleased(orderId); // reuse error — semantically same
        if (e.isDisputed)           revert EscrowDisputed(orderId);
        if (e.isReleased)           revert AlreadyReleased(orderId);

        // ── Effects ─────────────────────────────────────────────────────────
        e.isDelivered = true;

        emit Delivered(orderId);
    }

    /**
     * @notice Step 5 — Seller withdraws funds after buyer confirmed delivery.
     *         Platform fee is retained; net amount goes to seller.
     */
    function releaseFunds(bytes32 orderId) external nonReentrant {
        Escrow storage e = _getEscrow(orderId);

        // ── Checks ──────────────────────────────────────────────────────────
        if (e.seller != msg.sender) revert NotSeller(orderId);
        if (!e.isDelivered)         revert NotDelivered(orderId);
        if (e.isReleased)           revert AlreadyReleased(orderId);
        if (e.isRefunded)           revert AlreadyRefunded(orderId);
        if (e.isDisputed)           revert EscrowDisputed(orderId);

        // ── Effects ─────────────────────────────────────────────────────────
        e.isReleased = true;
        uint256 netAmount = e.amount - e.fee;
        accruedFees[e.token] += e.fee;

        // ── Interactions ────────────────────────────────────────────────────
        IERC20(e.token).safeTransfer(e.seller, netAmount);

        emit Released(orderId, e.seller, netAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Dispute system
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Either buyer or seller can open a dispute at any time after funding.
     *         Freezes all further lifecycle transitions until admin resolves.
     */
    function openDispute(bytes32 orderId) external {
        Escrow storage e = _getEscrow(orderId);

        // ── Checks ──────────────────────────────────────────────────────────
        if (e.buyer != msg.sender && e.seller != msg.sender) revert NotParty(orderId);
        if (!e.isFunded)    revert NotFunded(orderId);
        if (e.isReleased)   revert AlreadyReleased(orderId);
        if (e.isRefunded)   revert AlreadyRefunded(orderId);
        if (e.isDisputed)   revert EscrowDisputed(orderId);

        // ── Effects ─────────────────────────────────────────────────────────
        e.isDisputed = true;

        emit Disputed(orderId, msg.sender);
    }

    /**
     * @notice Admin (owner / DAO multisig) resolves a disputed escrow.
     * @param orderId          The disputed escrow
     * @param releaseToSeller  true → pay seller (net of fee); false → refund buyer (full amount)
     *
     * @dev  When resolving in the buyer's favour the full amount is returned
     *       (no fee charged, since transaction failed).
     *       When resolving in the seller's favour the standard platform fee applies.
     */
    function resolveDispute(bytes32 orderId, bool releaseToSeller)
        external
        onlyOwner
        nonReentrant
    {
        Escrow storage e = _getEscrow(orderId);

        // ── Checks ──────────────────────────────────────────────────────────
        if (!e.isDisputed)  revert EscrowNotDisputed(orderId);
        if (e.isReleased)   revert AlreadyReleased(orderId);
        if (e.isRefunded)   revert AlreadyRefunded(orderId);

        // ── Effects ─────────────────────────────────────────────────────────
        address recipient;
        uint256 payout;

        if (releaseToSeller) {
            e.isReleased = true;
            payout       = e.amount - e.fee;
            recipient    = e.seller;
            accruedFees[e.token] += e.fee;
        } else {
            e.isRefunded = true;
            payout       = e.amount; // full refund — no fee
            recipient    = e.buyer;
        }

        // ── Interactions ────────────────────────────────────────────────────
        IERC20(e.token).safeTransfer(recipient, payout);

        emit Resolved(orderId, releaseToSeller, recipient, payout);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Timeout system
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Seller can auto-claim funds if buyer has NOT confirmed delivery
     *         within DELIVERY_TIMEOUT (7 days) after shipment.
     *
     * @dev    Protects sellers from buyers who ghost after shipment.
     *         Dispute overrides timeout — if disputed, admin must resolve.
     */
    function claimTimeout(bytes32 orderId) external nonReentrant {
        Escrow storage e = _getEscrow(orderId);

        // ── Checks ──────────────────────────────────────────────────────────
        if (e.seller != msg.sender)  revert NotSeller(orderId);
        if (!e.isShipped)            revert NotShipped(orderId);
        if (e.isDelivered)           revert AlreadyReleased(orderId);
        if (e.isReleased)            revert AlreadyReleased(orderId);
        if (e.isRefunded)            revert AlreadyRefunded(orderId);
        if (e.isDisputed)            revert EscrowDisputed(orderId);

        uint256 deadline = e.shippedAt + DELIVERY_TIMEOUT;
        if (block.timestamp < deadline)
            revert TimeoutNotReached(orderId, deadline - block.timestamp);

        // ── Effects ─────────────────────────────────────────────────────────
        e.isReleased = true;
        uint256 netAmount = e.amount - e.fee;
        accruedFees[e.token] += e.fee;

        // ── Interactions ────────────────────────────────────────────────────
        IERC20(e.token).safeTransfer(e.seller, netAmount);

        emit TimeoutClaimed(orderId, e.seller, netAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Admin: fee & token management
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Update platform fee (capped at 5%).
     * @param newFeeBps  New fee in basis points (e.g. 150 = 1.5%)
     */
    function setFee(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    /**
     * @notice Update the address that receives platform fees.
     */
    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    /**
     * @notice Add or remove a token from the whitelist.
     * @dev    Only the owner can modify — prevents attack vectors via malicious tokens.
     */
    function setTokenAllowance(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        allowedTokens[token] = allowed;
        emit TokenAllowanceUpdated(token, allowed);
    }

    /**
     * @notice Withdraw accumulated platform fees for a given token.
     * @param token  USDC or EURC address
     */
    function withdrawFees(address token) external onlyOwner nonReentrant {
        uint256 amount = accruedFees[token];
        if (amount == 0) revert NoFeesToWithdraw(token);

        // ── Effects ─────────────────────────────────────────────────────────
        accruedFees[token] = 0;

        // ── Interactions ────────────────────────────────────────────────────
        IERC20(token).safeTransfer(feeRecipient, amount);

        emit FeesWithdrawn(token, feeRecipient, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  View helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Returns the full escrow struct for a given orderId.
     */
    function getEscrow(bytes32 orderId) external view returns (Escrow memory) {
        return escrows[orderId];
    }

    /**
     * @notice Returns true if the delivery timeout has passed for a shipped escrow.
     */
    function isTimedOut(bytes32 orderId) external view returns (bool) {
        Escrow storage e = escrows[orderId];
        return e.isShipped
            && !e.isDelivered
            && !e.isReleased
            && !e.isRefunded
            && !e.isDisputed
            && block.timestamp >= e.shippedAt + DELIVERY_TIMEOUT;
    }

    /**
     * @notice Returns seconds remaining before seller can claim timeout.
     *         Returns 0 if timeout has already passed or escrow is not shipped.
     */
    function timeoutRemaining(bytes32 orderId) external view returns (uint256) {
        Escrow storage e = escrows[orderId];
        if (!e.isShipped || e.shippedAt == 0) return 0;
        uint256 deadline = e.shippedAt + DELIVERY_TIMEOUT;
        if (block.timestamp >= deadline) return 0;
        return deadline - block.timestamp;
    }

    /**
     * @notice Compute the net amount seller would receive (after fee).
     */
    function netSellerAmount(bytes32 orderId) external view returns (uint256) {
        Escrow storage e = escrows[orderId];
        if (e.buyer == address(0)) revert EscrowNotFound(orderId);
        return e.amount - e.fee;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _getEscrow(bytes32 orderId) internal view returns (Escrow storage) {
        Escrow storage e = escrows[orderId];
        if (e.buyer == address(0)) revert EscrowNotFound(orderId);
        return e;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Safety: reject direct ETH (Arc Network is stablecoin-native)
    // ─────────────────────────────────────────────────────────────────────────

    receive() external payable {
        revert("RedHawkEscrow: ETH not accepted - use USDC or EURC");
    }

    fallback() external payable {
        revert("RedHawkEscrow: invalid call");
    }
}
