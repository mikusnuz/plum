import { useState, useCallback, useEffect, useRef } from 'react';
import { Spinner } from '@librechat/client';
import { useLocalize } from '~/hooks';

const WalletIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5"
  >
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
  </svg>
);

/** Find the best wallet provider, preferring PlumWallet via EIP-6963 + window.plumise */
function getProvider(): any {
  // 1. Check branded namespace (always PlumWallet, never overwritten)
  const plumise = (window as any).plumise?.ethereum;
  if (plumise) return plumise;

  // 2. Check window.ethereum.providers[] array (multi-wallet scenario)
  const providers = (window as any).ethereum?.providers;
  if (Array.isArray(providers)) {
    const plumProvider = providers.find((p: any) => p.isPlumWallet === true);
    if (plumProvider) return plumProvider;
  }

  // 3. Check if window.ethereum itself is PlumWallet
  if ((window as any).ethereum?.isPlumWallet) return (window as any).ethereum;

  // 4. Fallback: any provider
  return (window as any).ethereum ?? null;
}

type SiweLoginProps = {
  onSuccess: (data: { token: string; user: any }) => void;
  onError: (error: string) => void;
  serverDomain: string;
};

const SiweLogin: React.FC<SiweLoginProps> = ({ onSuccess, onError, serverDomain }) => {
  const localize = useLocalize();
  const [isLoading, setIsLoading] = useState(false);
  const eip6963Provider = useRef<any>(null);

  // Listen for EIP-6963 wallet announcements
  useEffect(() => {
    const handler = (event: any) => {
      const detail = event.detail;
      if (detail?.info?.rdns === 'com.plumbug.plumwallet' || detail?.provider?.isPlumWallet) {
        eip6963Provider.current = detail.provider;
      }
    };
    window.addEventListener('eip6963:announceProvider', handler);
    // Request announcements from installed wallets
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', handler);
  }, []);

  const handleSiweLogin = useCallback(async () => {
    // Prefer EIP-6963 discovered PlumWallet, then static detection
    const ethereum = eip6963Provider.current ?? getProvider();
    if (!ethereum) {
      onError('No wallet detected. Please install PlumWallet or MetaMask.');
      return;
    }

    setIsLoading(true);
    try {
      // 1. Request account access
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts[0];
      if (!address) {
        throw new Error('No account selected');
      }

      // 2. Get nonce from server
      const nonceRes = await fetch(`${serverDomain}/api/auth/siwe/nonce`);
      if (!nonceRes.ok) {
        throw new Error('Failed to get nonce');
      }
      const { nonce } = await nonceRes.json();

      // 3. Get chainId
      const chainIdHex = await ethereum.request({ method: 'eth_chainId' });
      const chainId = parseInt(chainIdHex, 16);

      // 4. Construct SIWE message (EIP-4361)
      const domain = window.location.host;
      const uri = window.location.origin;
      const issuedAt = new Date().toISOString();
      const message = [
        `${domain} wants you to sign in with your Ethereum account:`,
        address,
        '',
        'Sign in to Plum',
        '',
        `URI: ${uri}`,
        `Version: 1`,
        `Chain ID: ${chainId}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join('\n');

      // 5. Request signature
      const signature = await ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      });

      // 6. Verify with server
      const verifyRes = await fetch(`${serverDomain}/api/auth/siwe/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, signature }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        throw new Error(err.message || 'Verification failed');
      }

      const data = await verifyRes.json();
      onSuccess(data);
    } catch (err: any) {
      console.error('[SIWE] Login error:', err);
      if (err.code === 4001) {
        onError('Sign-in request was rejected');
      } else {
        // Pass raw error message so user can see what actually failed
        const msg = err.message || 'Wallet sign-in failed';
        onError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  }, [onSuccess, onError, serverDomain]);

  return (
    <div className="mt-2 flex gap-x-2">
      <button
        type="button"
        onClick={handleSiweLogin}
        disabled={isLoading}
        className="flex w-full items-center space-x-3 rounded-2xl border border-border-light bg-surface-primary px-5 py-3 text-text-primary transition-colors duration-200 hover:bg-surface-tertiary disabled:opacity-50"
        data-testid="siwe-login"
      >
        {isLoading ? <Spinner className="h-5 w-5" /> : <WalletIcon />}
        <p>Sign in with Wallet</p>
      </button>
    </div>
  );
};

export default SiweLogin;
