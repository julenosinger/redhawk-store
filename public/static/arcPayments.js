/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║   ARC COMMERCE — Circle USDC Payment Service Layer                      ║
 * ║   Integrates Circle Arc Commerce patterns into Shukly Store             ║
 * ║   Non-destructive: extends existing flow, never replaces it             ║
 * ║   Network: Arc Testnet (Chain ID: 5042002)                              ║
 * ║   Token: USDC (0x3600000000000000000000000000000000000000, 6 decimals)  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

(function (window) {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────
  const ARC_CHAIN_ID      = 5042002;
  const ARC_CHAIN_HEX     = '0x4CE2D2';
  const ARC_RPC           = 'https://rpc.testnet.arc.network';
  const ARC_RPC_ALT       = 'https://rpc.blockdaemon.testnet.arc.network';
  const ARC_EXPLORER      = 'https://testnet.arcscan.app';
  const USDC_ADDRESS      = '0x3600000000000000000000000000000000000000';
  const EURC_ADDRESS      = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
  const FAUCET_URL        = 'https://faucet.circle.com';
  const USDC_DECIMALS     = 6;

  // ─── ERC-20 minimal ABI ────────────────────────────────────────────────────
  const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
  ];

  // ─── ShuklyEscrow ABI ──────────────────────────────────────────────────────
  const ESCROW_ABI = [
    'function createEscrow(bytes32 orderId, address seller, address token, uint256 amount) external',
    'function fundEscrow(bytes32 orderId) external',
    'function confirmDelivery(bytes32 orderId) external',
    'function releaseFunds(bytes32 orderId) external',
    'function refund(bytes32 orderId) external',
    'function openDispute(bytes32 orderId) external',
    'function getEscrow(bytes32 orderId) external view returns (address buyer, address seller, address token, uint256 amount, uint8 state, uint256 createdAt)',
    'function escrows(bytes32) external view returns (address buyer, address seller, address token, uint256 amount, uint8 state, uint256 createdAt)',
    'function feeBps() external view returns (uint256)',
  ];

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Parse amount string to BigInt in token smallest units (6 dec) */
  function toWei(amount) {
    if (typeof ethers === 'undefined') throw new Error('[ArcPayments] ethers.js not loaded');
    const rounded = Math.round(parseFloat(amount) * 1_000_000) / 1_000_000;
    return ethers.parseUnits(rounded.toFixed(6), USDC_DECIMALS);
  }

  /** Format wei amount to human-readable USDC string */
  function fromWei(wei) {
    if (typeof ethers === 'undefined') return '0.00';
    return ethers.formatUnits(wei, USDC_DECIMALS);
  }

  /** Validate Ethereum address */
  function isValidAddress(addr) {
    return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
  }

  /** Check address is not zero */
  function isNonZeroAddress(addr) {
    return isValidAddress(addr) && addr !== '0x0000000000000000000000000000000000000000';
  }

  /** Get escrow contract address from global ARC config or localStorage */
  function getEscrowAddr() {
    const local = localStorage.getItem('shukly_escrow_address');
    if (local && isNonZeroAddress(local)) return local;
    const fromWin = window.ARC && window.ARC.contracts && window.ARC.contracts.ShuklyEscrow;
    if (fromWin && isNonZeroAddress(fromWin)) return fromWin;
    return null;
  }

  /** Get ethers provider — JsonRpc (internal wallet) or Browser (MetaMask) */
  async function getProvider(wallet) {
    if (typeof ethers === 'undefined') throw new Error('[ArcPayments] ethers.js not loaded');

    if (wallet && wallet.type === 'metamask' && window.ethereum) {
      const p = new ethers.BrowserProvider(window.ethereum);
      await p.send('eth_requestAccounts', []);
      return p;
    }

    // Fall back to RPC provider (try primary then alt)
    try {
      const p = new ethers.JsonRpcProvider(ARC_RPC);
      await p.getBlockNumber(); // quick liveness check
      return p;
    } catch (_) {
      return new ethers.JsonRpcProvider(ARC_RPC_ALT);
    }
  }

  /** Get signer from stored wallet */
  async function getSigner(wallet) {
    if (!wallet) throw new Error('No wallet connected');

    if (wallet.type === 'metamask' && window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      return provider.getSigner();
    }

    if ((wallet.type === 'internal' || wallet.type === 'imported') &&
        wallet.privateKey && !wallet.privateKey.startsWith('[')) {
      const provider = new ethers.JsonRpcProvider(ARC_RPC);
      return new ethers.Wallet(wallet.privateKey, provider);
    }

    throw new Error('Private key unavailable. Re-import wallet with seed phrase.');
  }

  /** Check if currently on Arc Testnet (MetaMask) */
  async function isOnArc() {
    if (!window.ethereum) return false;
    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      return parseInt(chainId, 16) === ARC_CHAIN_ID;
    } catch { return false; }
  }

  /** Switch MetaMask to Arc Testnet */
  async function ensureArcNetwork() {
    if (!window.ethereum) return true; // internal wallet — always "on Arc"

    if (await isOnArc()) return true;

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ARC_CHAIN_HEX }],
      });
      return true;
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId:           ARC_CHAIN_HEX,
              chainName:         'Arc Testnet',
              nativeCurrency:    { name: 'USDC', symbol: 'USDC', decimals: 6 },
              rpcUrls:           [ARC_RPC, ARC_RPC_ALT],
              blockExplorerUrls: [ARC_EXPLORER],
            }],
          });
          return true;
        } catch { return false; }
      }
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  ArcPayments — public API
  // ─────────────────────────────────────────────────────────────────────────

  const ArcPayments = {

    // ── 1. validateBalance ────────────────────────────────────────────────
    /**
     * Checks if the connected wallet has enough USDC.
     * @param {object} wallet  - stored wallet object
     * @param {string} amount  - required USDC amount (human-readable)
     * @param {'USDC'|'EURC'} token - token symbol
     * @returns {{ ok: boolean, balance: string, needed: string, shortfall: string }}
     */
    async validateBalance(wallet, amount, token = 'USDC') {
      try {
        const provider  = await getProvider(wallet);
        const tokenAddr = token === 'EURC' ? EURC_ADDRESS : USDC_ADDRESS;
        const erc20     = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
        const balance   = await erc20.balanceOf(wallet.address);
        const needed    = toWei(amount);
        const ok        = balance >= needed;
        const shortfall = ok ? BigInt(0) : needed - balance;

        return {
          ok,
          balance:   fromWei(balance),
          needed:    fromWei(needed),
          shortfall: fromWei(shortfall),
          faucet:    FAUCET_URL,
        };
      } catch (e) {
        console.error('[ArcPayments.validateBalance]', e);
        return { ok: false, balance: '0', needed: String(amount), shortfall: String(amount), faucet: FAUCET_URL };
      }
    },

    // ── 2. createPayment (approve + createEscrow + fundEscrow) ────────────
    /**
     * Full payment flow compatible with ShuklyEscrow contract.
     * Steps:
     *   1. Validate inputs
     *   2. Validate balance
     *   3. Ensure Arc network
     *   4. approve(escrow, MaxUint256)
     *   5. createEscrow(orderId32, seller, token, amount)
     *   6. fundEscrow(orderId32)
     *
     * @param {object} params
     * @param {string} params.orderId       - unique order identifier string
     * @param {string} params.sellerAddress - seller Ethereum address
     * @param {number|string} params.amount - USDC amount (human-readable)
     * @param {'USDC'|'EURC'} params.token  - token symbol
     * @param {object} params.wallet        - stored wallet object
     * @param {function} params.onStatus    - optional callback(step, message)
     * @returns {{ success: boolean, txHash?: string, createTxHash?: string, fundTxHash?: string, error?: string }}
     */
    async createPayment({ orderId, sellerAddress, amount, token = 'USDC', wallet, onStatus }) {
      const status = (step, msg) => {
        console.log(`[ArcPayments] [${step}] ${msg}`);
        if (typeof onStatus === 'function') onStatus(step, msg);
      };

      try {
        // ── Input validation ──────────────────────────────────────────
        if (!orderId || typeof orderId !== 'string')
          throw new Error('Invalid orderId');
        if (!isNonZeroAddress(sellerAddress))
          throw new Error('Invalid seller address');
        if (!isNonZeroAddress(wallet && wallet.address))
          throw new Error('Wallet address missing or invalid');
        if (parseFloat(amount) <= 0)
          throw new Error('Amount must be greater than 0');

        // Self-purchase guard
        if (wallet.address.toLowerCase() === sellerAddress.toLowerCase())
          throw new Error('You cannot purchase your own product');

        const escrowAddr  = getEscrowAddr();
        if (!escrowAddr)
          throw new Error('Escrow contract not configured. Contact support.');

        const tokenAddr   = token === 'EURC' ? EURC_ADDRESS : USDC_ADDRESS;

        // ── Balance validation ────────────────────────────────────────
        status('validate', `Checking ${token} balance…`);
        const bal = await this.validateBalance(wallet, amount, token);
        if (!bal.ok) {
          throw new Error(
            `Insufficient ${token} balance. You have ${parseFloat(bal.balance).toFixed(2)} ${token}, ` +
            `need ${parseFloat(bal.needed).toFixed(2)} ${token}. ` +
            `Get test tokens at ${FAUCET_URL}`
          );
        }
        status('validate', `Balance OK: ${parseFloat(bal.balance).toFixed(2)} ${token}`);

        // ── Network check ─────────────────────────────────────────────
        status('network', 'Checking Arc Testnet connection…');
        const onArc = await ensureArcNetwork();
        if (!onArc) throw new Error('Please switch to Arc Testnet manually in your wallet');

        // ── Get signer ────────────────────────────────────────────────
        status('signer', 'Connecting to wallet…');
        const signer = await getSigner(wallet);
        const signerAddr = (await signer.getAddress()).toLowerCase();
        console.log('[ArcPayments] signer:', signerAddr);

        const amountWei   = toWei(amount);
        const orderId32   = ethers.id(orderId);
        const erc20       = new ethers.Contract(tokenAddr,  ERC20_ABI,  signer);
        const escrow      = new ethers.Contract(escrowAddr, ESCROW_ABI, signer);

        // ── STEP 1: Approve ───────────────────────────────────────────
        status('approve', `Approving ${token} for escrow…`);
        const allowance = await erc20.allowance(signerAddr, escrowAddr);
        let approveTxHash = null;

        if (allowance < amountWei) {
          try {
            const approveTx = await erc20.approve(escrowAddr, ethers.MaxUint256);
            status('approve', `Approve tx sent: ${approveTx.hash.slice(0, 14)}… Waiting…`);
            approveTxHash = approveTx.hash;
            const approveReceipt = await approveTx.wait(1);
            if (!approveReceipt || approveReceipt.status === 0)
              throw new Error('Approve transaction reverted');
            status('approve', 'Approval confirmed ✓');
          } catch (err) {
            if (err.code === 4001 || err.code === 'ACTION_REJECTED')
              throw new Error('Approval rejected by user');
            throw new Error('Approve failed: ' + (err.shortMessage || err.reason || err.message));
          }
        } else {
          status('approve', `Allowance already sufficient (${fromWei(allowance)} ${token}) ✓`);
        }

        // ── STEP 2: createEscrow ──────────────────────────────────────
        status('createEscrow', `Creating escrow slot on-chain… orderId: ${orderId}`);
        let createTxHash;
        try {
          const createTx = await escrow.createEscrow(
            orderId32, sellerAddress, tokenAddr, amountWei, { gasLimit: 300_000 }
          );
          status('createEscrow', `createEscrow tx: ${createTx.hash.slice(0, 14)}… Waiting…`);
          createTxHash = createTx.hash;
          const createReceipt = await createTx.wait(1);
          if (!createReceipt || createReceipt.status === 0)
            throw new Error('createEscrow tx reverted — check contract inputs');
          status('createEscrow', 'Escrow slot created ✓');
        } catch (err) {
          if (err.code === 4001 || err.code === 'ACTION_REJECTED')
            throw new Error('createEscrow rejected by user');
          const msg = err.shortMessage || err.reason || err.message || String(err);
          if (msg.includes('execution reverted') || msg.includes('reverted'))
            throw new Error(
              `createEscrow reverted. Possible causes: Insufficient ${token} balance, ` +
              `Invalid seller address, Escrow slot already exists for this order ID.`
            );
          throw new Error('createEscrow failed: ' + msg);
        }

        // ── STEP 3: fundEscrow ────────────────────────────────────────
        status('fundEscrow', 'Locking funds in escrow…');
        let fundTxHash;
        try {
          const fundTx = await escrow.fundEscrow(orderId32, { gasLimit: 200_000 });
          status('fundEscrow', `fundEscrow tx: ${fundTx.hash.slice(0, 14)}… Waiting…`);
          fundTxHash = fundTx.hash;
          const fundReceipt = await fundTx.wait(1);
          if (!fundReceipt || fundReceipt.status === 0)
            throw new Error('fundEscrow tx reverted — check token allowance and escrow state');
          status('fundEscrow', 'Funds locked in escrow ✓');
        } catch (err) {
          if (err.code === 4001 || err.code === 'ACTION_REJECTED')
            throw new Error('fundEscrow rejected by user');
          const msg = err.shortMessage || err.reason || err.message || String(err);
          if (msg.includes('revert'))
            throw new Error(
              `fundEscrow reverted. Check that ${token} approve was confirmed and balance is sufficient.`
            );
          throw new Error('fundEscrow failed: ' + msg);
        }

        status('complete', `Payment complete! Funds locked in escrow. Fund tx: ${fundTxHash}`);

        return {
          success:      true,
          orderId,
          createTxHash,
          fundTxHash,
          txHash:       fundTxHash, // primary tx hash for display
          approveTxHash,
          explorerUrl:  `${ARC_EXPLORER}/tx/${fundTxHash}`,
        };

      } catch (e) {
        console.error('[ArcPayments.createPayment]', e);
        return { success: false, error: e.message || String(e) };
      }
    },

    // ── 3. executePayment (alias for createPayment, simpler signature) ────
    /**
     * Convenience wrapper — same as createPayment, used from checkout page.
     */
    async executePayment(orderId, sellerAddress, amount, token, wallet, onStatus) {
      return this.createPayment({ orderId, sellerAddress, amount, token, wallet, onStatus });
    },

    // ── 4. getOnChainEscrowState ──────────────────────────────────────────
    /**
     * Query escrow contract directly for real-time on-chain state.
     * States: 0=EMPTY, 1=FUNDED, 2=CONFIRMED, 3=RELEASED, 4=REFUNDED, 5=DISPUTED
     * @param {string} orderId - order identifier string
     * @returns {{ state: number, buyer: string, seller: string, amount: string, exists: boolean }}
     */
    async getOnChainEscrowState(orderId) {
      try {
        const escrowAddr = getEscrowAddr();
        if (!escrowAddr) return { exists: false, state: 0 };

        const provider = new ethers.JsonRpcProvider(ARC_RPC);
        const escrow   = new ethers.Contract(escrowAddr, ESCROW_ABI, provider);
        const orderId32 = ethers.id(orderId);

        const result = await escrow.escrows(orderId32);
        const state  = Number(result.state);

        // state=0 AND buyer=zero means escrow doesn't exist
        const exists = isNonZeroAddress(result.buyer);

        return {
          exists,
          state,
          stateLabel: ['EMPTY', 'FUNDED', 'CONFIRMED', 'RELEASED', 'REFUNDED', 'DISPUTED'][state] || 'UNKNOWN',
          buyer:  result.buyer,
          seller: result.seller,
          token:  result.token,
          amount: fromWei(result.amount),
        };
      } catch (e) {
        console.warn('[ArcPayments.getOnChainEscrowState]', e.message);
        return { exists: false, state: 0 };
      }
    },

    // ── 5. handleErrors — Standardised error classifier ──────────────────
    /**
     * Classifies an error and returns a user-friendly message + suggested action.
     */
    handleErrors(error) {
      const msg = (error && (error.message || String(error))) || '';
      const lower = msg.toLowerCase();

      if (lower.includes('insufficient') || lower.includes('balance'))
        return { type: 'balance', message: msg, action: `Get test USDC at ${FAUCET_URL}`, faucet: FAUCET_URL };

      if (lower.includes('wrong network') || lower.includes('switch') || lower.includes('chain'))
        return { type: 'network', message: 'Please switch to Arc Testnet (Chain ID: 5042002)', action: 'Switch network' };

      if (lower.includes('own product') || lower.includes('seller'))
        return { type: 'self_purchase', message: 'You cannot buy your own product', action: null };

      if (lower.includes('rejected') || lower.includes('denied') || lower.includes('4001'))
        return { type: 'rejected', message: 'Transaction was rejected', action: 'Try again' };

      if (lower.includes('reverted') || lower.includes('revert'))
        return { type: 'revert', message: msg, action: 'Check contract state and try again' };

      if (lower.includes('double') || lower.includes('already exist'))
        return { type: 'duplicate', message: 'This order already exists in escrow', action: 'Check your orders' };

      if (lower.includes('invalid') || lower.includes('address'))
        return { type: 'invalid_address', message: 'Invalid address detected', action: 'Contact support' };

      return { type: 'unknown', message: msg || 'An unexpected error occurred', action: 'Try again or contact support' };
    },

    // ── 6. getBalance — Quick USDC balance lookup ─────────────────────────
    async getBalance(walletAddress, token = 'USDC') {
      try {
        const tokenAddr = token === 'EURC' ? EURC_ADDRESS : USDC_ADDRESS;
        const provider  = new ethers.JsonRpcProvider(ARC_RPC);
        const erc20     = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
        const raw       = await erc20.balanceOf(walletAddress);
        return { ok: true, balance: fromWei(raw), raw };
      } catch (e) {
        return { ok: false, balance: '0.00', raw: BigInt(0), error: e.message };
      }
    },

    // ── 7. isAvailable — Check if Arc payment layer is ready ─────────────
    isAvailable() {
      return typeof ethers !== 'undefined' && isNonZeroAddress(getEscrowAddr());
    },

    // ── 8. getNetworkInfo — Arc Testnet metadata ─────────────────────────
    getNetworkInfo() {
      return {
        chainId:    ARC_CHAIN_ID,
        chainHex:   ARC_CHAIN_HEX,
        name:       'Arc Testnet',
        rpc:        ARC_RPC,
        explorer:   ARC_EXPLORER,
        faucet:     FAUCET_URL,
        usdc:       USDC_ADDRESS,
        eurc:       EURC_ADDRESS,
        isTestnet:  true,
      };
    },
  };

  // ─── Expose globally ───────────────────────────────────────────────────────
  window.ArcPayments = ArcPayments;

  // ─── useArcPayment hook (plain-JS hook pattern, no React) ─────────────────
  /**
   * useArcPayment — stateful payment hook for use in page scripts.
   *
   * Usage:
   *   const payment = useArcPayment();
   *   await payment.pay({ orderId, sellerAddress, amount, token, wallet });
   *   console.log(payment.state);  // 'idle' | 'loading' | 'success' | 'error'
   */
  window.useArcPayment = function useArcPayment(onStateChange) {
    let _state   = 'idle';   // idle | loading | success | error
    let _step    = '';
    let _result  = null;
    let _error   = null;

    function setState(s, step, result, error) {
      _state  = s;
      _step   = step  || '';
      _result = result || null;
      _error  = error || null;
      if (typeof onStateChange === 'function')
        onStateChange({ state: _state, step: _step, result: _result, error: _error });
    }

    return {
      get state()  { return _state; },
      get step()   { return _step; },
      get result() { return _result; },
      get error()  { return _error; },

      async pay({ orderId, sellerAddress, amount, token, wallet }) {
        setState('loading', 'Starting payment…');
        try {
          const result = await ArcPayments.createPayment({
            orderId, sellerAddress, amount, token, wallet,
            onStatus: (step, msg) => setState('loading', msg),
          });
          if (result.success) {
            setState('success', 'Payment complete', result);
          } else {
            const classified = ArcPayments.handleErrors({ message: result.error });
            setState('error', classified.message, null, classified);
          }
          return result;
        } catch (e) {
          const classified = ArcPayments.handleErrors(e);
          setState('error', classified.message, null, classified);
          return { success: false, error: e.message };
        }
      },

      reset() { setState('idle'); },
    };
  };

  console.log('[ArcPayments] Service layer loaded. Available:', ArcPayments.isAvailable());

})(window);
